import { Router, Request, Response, NextFunction } from 'express';
import { PgUserRepo, PgApprovalRuleRepo, pool } from '@sse/db';
import { authMiddleware, hashPassword, validatePassword } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@sse/shared';
import { welcomeMessage } from '@sse/notifications';
import { AppError } from '../middleware/error';
import { sendNotificationSafe } from '../services/notifications';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  applyAiConfigPatch,
  classifyEngineError,
  mergeCatalog,
  normalizeServiceBase,
  resolveSecretForEndpoint,
  sanitizeEndpoint,
  toPublicAiConfig,
  type AiConfig,
} from '@sse/ai';
import {
  createOCREngine,
  getSmartFillEngine,
  loadAiConfig,
  saveAiConfig,
} from '../services/ai-engines';
import {
  addTestHistory,
  clearTestHistory,
  loadTestHistory,
  newHistoryEntry,
} from '../services/ai-test-history';
import { fetchModelList, testConnection } from '../services/ai-engine-probe';
import { uploadEngineSample, uploadErrorHandler, hasValidSampleSignature } from '../middleware/upload';
import { resetEngine } from './ontology-helpers';

const router = Router();
const userRepo = new PgUserRepo();
const ruleRepo = new PgApprovalRuleRepo();

const USER_COLUMNS = 'id, name, phone, email, department, role, parent_id, status, deleted_at, created_at, updated_at';

const SAMPLE_INVOICE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'dzfp_25362000000115126055_深圳市数恒纪元信息技术咨询企业（个人独资）_20251106105357.pdf',
);

// ========== 简易内存限流 ==========
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

const rateLimitSweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);
rateLimitSweeper.unref?.();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function enforceRateLimit(req: Request, _res: Response, next: NextFunction) {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    next(new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试'));
    return;
  }
  next();
}

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

// ========== 用户管理 ==========

router.get(
  '/users',
  asyncWrap(async (req, res) => {
    const include = req.query.include as string | undefined;
    if (include === 'deleted') {
      const { rows } = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE status = 'deleted' ORDER BY name`
      );
      res.json(rows.map(mapUserRow));
      return;
    }
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE status != 'deleted' ORDER BY name`
    );
    res.json(rows.map(mapUserRow));
  })
);

router.post(
  '/users',
  asyncWrap(async (req, res) => {
    const { name, phone, email, department, role, password } = req.body;

    if (!name || !phone || !department || !role) {
      throw new AppError(400, 'INVALID_PARAMS', '名称、手机号、部门、角色不能为空');
    }

    if (!password) {
      throw new AppError(400, 'INVALID_PARAMS', '密码不能为空');
    }

    const invalidPassword = validatePassword(password);
    if (invalidPassword) {
      throw new AppError(400, 'INVALID_PARAMS', invalidPassword);
    }

    const existing = await userRepo.findByPhone(phone);
    if (existing) {
      throw new AppError(400, 'INVALID_PARAMS', '手机号已存在');
    }

    const passwordHash = await hashPassword(password);

    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, email, department, role, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING ${USER_COLUMNS}`,
      [name, phone, email || null, department, role, passwordHash]
    );

    const created = mapUserRow(rows[0]);
    void sendNotificationSafe(created.id, welcomeMessage({ name: created.name }));
    res.status(201).json(created);
  })
);

// ========== 角色校验 ==========

router.get(
  '/users/validate',
  asyncWrap(async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT role, COUNT(*)::int as count FROM users WHERE status = 'active' GROUP BY role"
    );
    const result: Record<string, number> = {
      employee: 0,
      dept_approver: 0,
      finance: 0,
      admin: 0,
    };
    for (const row of rows) {
      if (result.hasOwnProperty(row.role)) {
        result[row.role] = row.count;
      }
    }
    res.json(result);
  })
);

router.get(
  '/users/:id',
  asyncWrap(async (req, res) => {
    const user = await userRepo.findById(req.params.id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', '用户不存在');
    }
    res.json(user);
  })
);

router.put(
  '/users/:id',
  asyncWrap(async (req, res) => {
    const { id } = req.params;
    const { name, phone, email, department, role, status, password } = req.body;

    const user = await userRepo.findById(id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', '用户不存在');
    }

    if (status !== undefined && user.status === 'deleted') {
      throw new AppError(400, 'INVALID_PARAMS', '已删除的用户不可修改状态');
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(phone); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (department !== undefined) { fields.push(`department = $${idx++}`); values.push(department); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }

    if (password !== undefined && password !== '') {
      const invalidPassword = validatePassword(password);
      if (invalidPassword) {
        throw new AppError(400, 'INVALID_PARAMS', invalidPassword);
      }
      const passwordHash = await hashPassword(password);
      fields.push(`password_hash = $${idx++}`);
      values.push(passwordHash);
    }

    if (fields.length === 0) {
      res.json(user);
      return;
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING ${USER_COLUMNS}`,
      values
    );

    res.json(mapUserRow(rows[0]));

    // async: sync name/department change to ontology
    if (name !== undefined || department !== undefined) {
      const updated = rows[0];
      syncUserToOntology({ id: updated.id, name: updated.name, phone: updated.phone, department: updated.department }).catch(() => {});
    }
  })
);

router.delete(
  '/users/:id',
  asyncWrap(async (req, res) => {
    const { id } = req.params;
    const deleteType = (req.query.type as string) || 'soft';

    const user = await userRepo.findById(id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', '用户不存在');
    }

    if (deleteType === 'hard') {
      const relatedCount = await userRepo.getRelatedDataCount(id);
      if (relatedCount > 0) {
        throw new AppError(409, 'HAS_RELATED_DATA',
          `该用户存在 ${relatedCount} 条业务数据（报销单/审批记录/通知日志），请使用软删除或级联删除`);
      }
      await userRepo.hardDelete(id);
      res.json({ message: '用户已永久删除' });
    } else if (deleteType === 'cascade') {
      await userRepo.cascadeDelete(id);
      res.json({ message: '用户及所有关联数据已永久删除' });
    } else {
      await userRepo.softDelete(id);
      res.json({ message: '用户已删除', deletedAt: new Date().toISOString() });
    }
  })
);

// ========== 费用类别管理 ==========

router.get(
  '/categories',
  asyncWrap(async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT id, name, parent_id, sort_order, is_active, created_at FROM expense_categories ORDER BY name'
    );
    res.json(
      rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        parentId: r.parent_id ?? undefined,
        isActive: r.is_active,
        createdAt: r.created_at,
      }))
    );
  })
);

router.post(
  '/categories',
  asyncWrap(async (req, res) => {
    const { name, parentId } = req.body;

    if (!name) {
      throw new AppError(400, 'INVALID_PARAMS', '类别名称不能为空');
    }

    const { rows } = await pool.query(
      `INSERT INTO expense_categories (name, parent_id, is_active)
       VALUES ($1, $2, true)
       RETURNING *`,
      [name, parentId || null]
    );

    res.status(201).json({
      id: rows[0].id,
      name: rows[0].name,
      parentId: rows[0].parent_id ?? undefined,
      isActive: rows[0].is_active,
      createdAt: rows[0].created_at,
    });
  })
);

// ========== 审批规则管理 ==========

router.get(
  '/rules',
  asyncWrap(async (_req, res) => {
    const rules = await ruleRepo.findAll();
    res.json(rules);
  })
);

router.get(
  '/rules/:id',
  asyncWrap(async (req, res) => {
    const rule = await ruleRepo.findById(req.params.id);
    if (!rule) {
      throw new AppError(404, 'NOT_FOUND', '规则不存在');
    }
    res.json(rule);
  })
);

router.post(
  '/rules',
  asyncWrap(async (req, res) => {
    const { name, minAmount, maxAmount, categoryIds, approvalChain, priority, isActive } = req.body;

    if (!name || minAmount === undefined || maxAmount === undefined || !approvalChain || !Array.isArray(approvalChain)) {
      throw new AppError(400, 'INVALID_PARAMS', '名称、金额区间、审批链不能为空');
    }

    const rule = await ruleRepo.create({
      name,
      minAmount: Number(minAmount),
      maxAmount: Number(maxAmount),
      categoryIds: categoryIds || undefined,
      approvalChain,
      priority: priority ?? 0,
      isActive: isActive ?? true,
    });

    res.status(201).json(rule);
  })
);

router.put(
  '/rules/:id',
  asyncWrap(async (req, res) => {
    const { id } = req.params;
    const existing = await ruleRepo.findById(id);
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '规则不存在');
    }

    const patch: any = {};
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.minAmount !== undefined) patch.minAmount = Number(req.body.minAmount);
    if (req.body.maxAmount !== undefined) patch.maxAmount = Number(req.body.maxAmount);
    if (req.body.categoryIds !== undefined) patch.categoryIds = req.body.categoryIds;
    if (req.body.approvalChain !== undefined) patch.approvalChain = req.body.approvalChain;
    if (req.body.priority !== undefined) patch.priority = req.body.priority;
    if (req.body.isActive !== undefined) patch.isActive = req.body.isActive;

    await ruleRepo.update(id, patch);

    const updated = await ruleRepo.findById(id);
    res.json(updated);
  })
);

router.delete(
  '/rules/:id',
  asyncWrap(async (req, res) => {
    const { id } = req.params;
    const existing = await ruleRepo.findById(id);
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '规则不存在');
    }

    await ruleRepo.delete(id);
    res.json({ message: '规则已删除' });
  })
);

// ========== 部门管理 ==========

router.get(
  '/departments',
  asyncWrap(async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT department as name, COUNT(*)::int as user_count FROM users WHERE department IS NOT NULL GROUP BY department ORDER BY department'
    );
    res.json(rows);
  })
);

router.post(
  '/departments',
  asyncWrap(async (req, res) => {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError(400, 'INVALID_PARAMS', '部门名称不能为空');
    }

    const trimmed = name.trim();
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int as count FROM users WHERE department = $1',
      [trimmed]
    );
    if (rows[0].count > 0) {
      throw new AppError(400, 'INVALID_PARAMS', '部门名称已存在');
    }

    res.status(201).json({ name: trimmed });
  })
);

// ========== AI 模型配置 ==========

router.get(
  '/ai-models',
  asyncWrap(async (_req, res) => {
    const config = loadAiConfig();
    try {
      const result = await fetchModelList({
        endpoint: config.fillEngine.endpoint,
        apiKey: config.fillEngine.apiKey,
      });
      res.json({
        models: result.models.map(model => ({
          ...model,
          recommended: false,
          reason: '',
        })),
        source: result.source,
        elapsedMs: result.elapsedMs,
      });
    } catch {
      res.json({ models: [], source: 'openai', elapsedMs: 0 });
    }
  }),
);

router.post(
  '/ai-models',
  enforceRateLimit,
  asyncWrap(async (req, res) => {
    const saved = loadAiConfig();
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) throw new AppError(400, 'INVALID_PARAMS', '请填写 API 地址');
    const apiKey = resolveSecretForEndpoint(
      endpoint,
      req.body?.apiKey,
      saved.fillEngine.endpoint,
      saved.fillEngine.apiKey,
    );
    try {
      const result = await fetchModelList({ endpoint, apiKey });
      const key = normalizeServiceBase(endpoint);
      const catalog = mergeCatalog(saved.fillEngine.catalogs[key], result.models, result.source);
      res.json({ ...result, catalog });
    } catch (error: any) {
      const info = classifyEngineError(error, { status: error?.status });
      res.status(400).json({ success: false, message: info.message, error: info });
    }
  }),
);

router.get(
  '/ai-config',
  asyncWrap(async (_req, res) => {
    res.json(toPublicAiConfig(loadAiConfig()));
  }),
);

router.put(
  '/ai-config',
  asyncWrap(async (req, res) => {
    const saved = loadAiConfig();
    const next = applyAiConfigPatch(saved, req.body || {});
    saveAiConfig(next);
    resetEngine();
    res.json(toPublicAiConfig(next));
  }),
);

router.post(
  '/ai-connection-test',
  enforceRateLimit,
  asyncWrap(async (req, res) => {
    const saved = loadAiConfig();
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) throw new AppError(400, 'INVALID_PARAMS', '请填写 API 地址');
    const apiKey = resolveSecretForEndpoint(
      endpoint,
      req.body?.apiKey,
      saved.fillEngine.endpoint,
      saved.fillEngine.apiKey,
    );
    const result = await testConnection({
      endpoint,
      apiKey,
      model: req.body?.model,
    });

    const failed = result.steps.find(step => !step.ok);
    addTestHistory(newHistoryEntry({
      type: 'connection',
      endpoint: normalizeServiceBase(endpoint),
      success: result.success,
      elapsedMs: result.steps.reduce((sum, step) => sum + step.elapsedMs, 0),
      fields: { steps: result.steps },
      error: failed?.error,
    }));

    res.json(result);
  }),
);

router.post(
  '/ai-test/fill',
  enforceRateLimit,
  asyncWrap(async (req, res) => {
    const saved = loadAiConfig();
    const endpoint = String(req.body?.endpoint || saved.fillEngine.endpoint);
    const apiKey = resolveSecretForEndpoint(
      endpoint,
      req.body?.apiKey,
      saved.fillEngine.endpoint,
      saved.fillEngine.apiKey,
    );
    const config: AiConfig = {
      ...saved,
      fillEngine: {
        ...saved.fillEngine,
        endpoint: normalizeServiceBase(endpoint),
        apiKey,
        model: String(req.body?.model || saved.fillEngine.model),
      },
    };

    const start = Date.now();
    try {
      const engine = getSmartFillEngine(config);
      if (!engine) throw new Error('智能填单引擎未启用');
      const items = await engine.parseFromText('测试：打车50元');
      const success = items.length > 0;
      const message = success
        ? `文字识别成功，解析到 ${items.length} 条费用`
        : '模型响应但未解析到结构化数据';
      const elapsedMs = Date.now() - start;
      addTestHistory(newHistoryEntry({
        type: 'fill',
        endpoint: config.fillEngine.endpoint,
        success,
        elapsedMs,
        fields: { itemCount: items.length },
      }));
      res.json({ success, message, elapsedMs, items });
    } catch (error: any) {
      const info = classifyEngineError(error);
      const elapsedMs = Date.now() - start;
      addTestHistory(newHistoryEntry({
        type: 'fill',
        endpoint: config.fillEngine.endpoint,
        success: false,
        elapsedMs,
        error: info,
      }));
      res.json({ success: false, message: info.message, elapsedMs, error: info });
    }
  }),
);

router.post(
  '/ai-test/ocr',
  enforceRateLimit,
  uploadEngineSample.single('file'),
  uploadErrorHandler,
  asyncWrap(async (req, res) => {
    const saved = loadAiConfig();
    const requestedProvider = String(req.body?.provider || '');
    const provider = requestedProvider === 'mineru'
      || requestedProvider === 'paddle'
      || requestedProvider === 'vision'
      ? (requestedProvider as AiConfig['ocrEngine']['provider'])
      : saved.ocrEngine.provider;
    const mineruEndpoint = normalizeServiceBase(String(req.body?.mineruEndpoint || saved.ocrEngine.mineruEndpoint));
    const paddleEndpoint = normalizeServiceBase(String(req.body?.paddleEndpoint || saved.ocrEngine.paddleEndpoint));
    const visionEndpoint = normalizeServiceBase(String(req.body?.visionEndpoint || saved.ocrEngine.visionEndpoint));
    const mineruToken = resolveSecretForEndpoint(
      mineruEndpoint,
      req.body?.mineruToken,
      saved.ocrEngine.mineruEndpoint,
      saved.ocrEngine.mineruToken,
    );
    const visionApiKey = resolveSecretForEndpoint(
      visionEndpoint,
      req.body?.visionApiKey,
      saved.ocrEngine.visionEndpoint,
      saved.ocrEngine.visionApiKey,
    );

    const config: AiConfig = {
      ...saved,
      ocrEngine: {
        ...saved.ocrEngine,
        provider,
        mineruEndpoint,
        mineruToken,
        paddleEndpoint,
        visionEndpoint,
        visionModel: String(req.body?.visionModel || saved.ocrEngine.visionModel),
        visionApiKey,
      },
    };

    let buffer: Buffer;
    let fileName: string;
    if (req.file) {
      const dot = req.file.originalname.lastIndexOf('.');
      const ext = dot >= 0 ? req.file.originalname.slice(dot + 1).toLowerCase() : '';
      if (!hasValidSampleSignature(req.file.buffer, ext)) {
        throw new AppError(400, 'INVALID_FILE_CONTENT', '样例文件内容与扩展名不匹配');
      }
      buffer = req.file.buffer;
      fileName = `sample.${ext || 'pdf'}`;
    } else {
      if (!existsSync(SAMPLE_INVOICE_PATH)) {
        throw new AppError(400, 'SAMPLE_MISSING', '内置样例发票不存在，请上传样例文件');
      }
      buffer = readFileSync(SAMPLE_INVOICE_PATH);
      fileName = 'sample.pdf';
    }

    const endpoint = provider === 'mineru' ? mineruEndpoint : provider === 'paddle' ? paddleEndpoint : visionEndpoint;
    const start = Date.now();
    try {
      const engine = createOCREngine(config);
      if (!engine) throw new Error('发票 OCR 引擎未启用');
      const result = await engine.parseInvoice(buffer, fileName);
      const fields = {
        invoiceNo: result.invoiceNo,
        amount: result.amount,
        totalAmount: result.totalAmount,
        invoiceDate: result.invoiceDate,
        sellerName: result.sellerName,
        buyerName: result.buyerName,
        taxAmount: result.taxAmount,
      };
      const success = !!(fields.invoiceNo || fields.totalAmount || fields.amount);
      const error = success
        ? undefined
        : classifyEngineError(new Error('未识别到发票信息'));
      const elapsedMs = Date.now() - start;
      addTestHistory(newHistoryEntry({
        type: 'ocr',
        provider,
        endpoint,
        success,
        elapsedMs,
        fields,
        error,
        rawText: result.rawText,
      }));
      res.json({
        success,
        elapsedMs,
        provider,
        endpoint: sanitizeEndpoint(endpoint) || endpoint,
        fields,
        rawText: (result.rawText || '').slice(0, 5000),
        error: error || null,
      });
    } catch (error: any) {
      const info = classifyEngineError(error, { status: error?.status });
      const elapsedMs = Date.now() - start;
      addTestHistory(newHistoryEntry({
        type: 'ocr',
        provider,
        endpoint,
        success: false,
        elapsedMs,
        error: info,
      }));
      res.json({
        success: false,
        elapsedMs,
        provider,
        endpoint: sanitizeEndpoint(endpoint) || endpoint,
        fields: {},
        rawText: '',
        error: info,
      });
    }
  }),
);

router.get(
  '/ai-test-history',
  asyncWrap(async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;
    const entries = loadTestHistory()
      .filter(entry => !type || entry.type === type)
      .slice(0, limit);
    res.json(entries);
  }),
);

router.delete(
  '/ai-test-history',
  asyncWrap(async (_req, res) => {
    clearTestHistory();
    res.json({ message: '测试历史已清空' });
  }),
);

router.post(
  '/ai-test',
  asyncWrap(async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    }

    const { type } = req.body;
    const config = loadAiConfig();
    const fillCfg = config.fillEngine;
    const ocrCfg = config.ocrEngine;

    let result: string;
    let success = false;
    try {
      const start = Date.now();

      if (type === 'text') {
        const engine = getSmartFillEngine(config);
        if (!engine) {
          result = '智能填单引擎未启用';
        } else {
          const items = await engine.parseFromText('测试：打车50元');
          const elapsed = Date.now() - start;
          if (items.length > 0) {
            result = `文字识别成功（${elapsed}ms），解析到 ${items.length} 条费用`;
            success = true;
          } else {
            result = `模型响应但未解析到结构化数据（${elapsed}ms）`;
          }
        }
      } else if (type === 'ocr') {
        const pdfPath = SAMPLE_INVOICE_PATH;
        if (!existsSync(pdfPath)) {
          result = `发票样例文件不存在: ${pdfPath}`;
        } else {
          const engine = createOCREngine(config);
          if (!engine) {
            result = '发票 OCR 引擎未启用';
          } else {
            const pdfBuffer = readFileSync(pdfPath);
            const label = ocrCfg.provider === 'mineru' ? 'MinerU' : ocrCfg.provider === 'paddle' ? 'PaddleOCR' : '视觉模型';
            const ocrResult = await engine.parseInvoice(pdfBuffer, 'sample.pdf');
            result = formatOcrResult(ocrResult, Date.now() - start, label);
            success = !!(ocrResult.invoiceNo || ocrResult.totalAmount || ocrResult.amount);
          }
        }
      } else {
        result = '不支持的测试类型';
      }
    } catch (e: any) {
      result = `连接失败: ${e.message}`;
    }

    res.json({ success, message: result });
  })
);

function formatOcrResult(r: any, elapsed: number, engine: string): string {
  if (r.invoiceNo || r.amount) {
    return `${engine}识别成功（${elapsed}ms）：发票号 ${r.invoiceNo || 'N/A'}，金额 ${r.amount || r.totalAmount || 'N/A'}`;
  }
  return `${engine}接口连通（${elapsed}ms），但未识别到发票信息`;
}

function mapUserRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? undefined,
    department: row.department,
    role: row.role,
    parentId: row.parent_id ?? undefined,
    status: row.status,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ========== 推理规则管理 ==========

router.get('/reasoning-rules', asyncWrap(async (_req, res) => {
  const { PgReasoningRuleRepo } = await import('@sse/db');
  const rules = await new PgReasoningRuleRepo().findAll();
  res.json(rules);
}));

router.post('/reasoning-rules', asyncWrap(async (req, res) => {
  const { name, description, conditions, conclusion, priority, isActive } = req.body;
  if (!name || !conditions || !conclusion) throw new AppError(400, 'INVALID_PARAMS', '名称、条件、结论不能为空');
  const { PgReasoningRuleRepo } = await import('@sse/db');
  const rule = await new PgReasoningRuleRepo().create({ name, description, conditions, conclusion, priority: priority ?? 0, isActive: isActive ?? true });
  res.status(201).json(rule);
}));

router.put('/reasoning-rules/:id', asyncWrap(async (req, res) => {
  const { PgReasoningRuleRepo } = await import('@sse/db');
  await new PgReasoningRuleRepo().update(req.params.id, req.body);
  res.json({ message: '更新成功' });
}));

router.delete('/reasoning-rules/:id', asyncWrap(async (req, res) => {
  const { PgReasoningRuleRepo } = await import('@sse/db');
  await new PgReasoningRuleRepo().delete(req.params.id);
  res.json({ message: '已删除' });
}));

async function syncUserToOntology(user: { id: string; name: string; phone: string; department: string }) {
  try {
    const { getEngine } = await import('./ontology-helpers');
    const engine = getEngine();
    const base = 'https://sse.local';
    const personUri = `${base}/person/${user.id}`;
    engine.store.addEntity(personUri, 'Person', { name: user.name, phone: user.phone, department: user.department });
    if (user.department && user.department !== '未分配') {
      const deptUri = `${base}/dept/${user.department}`;
      engine.store.addEntity(deptUri, 'Department', { name: user.department });
      engine.store.addRelation(personUri, 'sse:belongsTo', deptUri);
    }
    await engine.store.saveToDb().catch(() => {});
  } catch { /* best effort */ }
}

export { router as adminRoutes };
