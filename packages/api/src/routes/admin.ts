import { Router, Request, Response, NextFunction } from 'express';
import { PgUserRepo, PgApprovalRuleRepo, pool } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@sse/shared';
import { AppError } from '../middleware/error';

import { LocalProvider, SmartFillEngine, InvoiceOCREngine, MinerUProvider, PaddleProvider, VisionOCRProvider } from '@sse/ai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();
const userRepo = new PgUserRepo();
const ruleRepo = new PgApprovalRuleRepo();

const USER_COLUMNS = 'id, name, phone, email, department, role, parent_id, status, deleted_at, created_at, updated_at';

// ========== 简易内存限流 ==========
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

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

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

const CONFIG_PATH = join(process.cwd(), 'ai-config.json');

function loadAiConfig() {
  const defaults = {
    fillEngine: {
      endpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      model: process.env.AI_MODEL || 'llama3.1:8b',
      enabled: true,
    },
    ocrEngine: {
      provider: 'mineru' as 'mineru' | 'paddle' | 'vision',
      mineruEndpoint: process.env.MINERU_ENDPOINT || 'https://mineru.net',
      paddleEndpoint: process.env.PADDLE_ENDPOINT || 'http://localhost:8899',
      visionEndpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      visionModel: process.env.AI_VISION_MODEL || 'glm-ocr',
      enabled: true,
    },
  };
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...defaults, ...saved,
        fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) },
        ocrEngine: { ...defaults.ocrEngine, ...(saved.ocrEngine || {}) },
      };
    }
  } catch { /* use defaults */ }
  return defaults;
}

function saveAiConfig(config: any) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
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

    const existing = await userRepo.findByPhone(phone);
    if (existing) {
      throw new AppError(400, 'INVALID_PARAMS', '手机号已存在');
    }

    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, email, department, role, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, '', 'active')
       RETURNING ${USER_COLUMNS}`,
      [name, phone, email || null, department, role]
    );

    res.status(201).json(mapUserRow(rows[0]));
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
    const { name, phone, email, department, role, status } = req.body;

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

const RECOMMENDED_MODELS = ['llama3.1:8b', 'deepseek-r1:8b', 'qwen2.5-vl:7b'];

interface ModelInfo {
  id: string; name: string; recommended: boolean; reason: string;
}

router.get(
  '/ai-models',
  asyncWrap(async (_req, res) => {
    const config = loadAiConfig();
    let models: ModelInfo[] = [];

    try {
      const resp = await fetch(config.endpoint.replace('/chat/completions', '/models'), {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      });
      if (resp.ok) {
        const data: any = await resp.json();
        const rawModels = data.data || data.models || [];
        models = rawModels.map((m: any) => {
          const name = m.id || m.name || '';
          const isRecommended = RECOMMENDED_MODELS.some(r => name.includes(r));
          const reason = isRecommended
            ? '推荐：中文支持好，速度与精度均衡'
            : '';
          return { id: name, name, recommended: isRecommended, reason };
        });
      }
    } catch {
      models = RECOMMENDED_MODELS.map(name => ({
        id: name, name, recommended: true, reason: '推荐',
      }));
    }

    res.json({ models });
  })
);

router.get(
  '/ai-config',
  asyncWrap(async (_req, res) => {
    res.json(loadAiConfig());
  })
);

router.put(
  '/ai-config',
  asyncWrap(async (req, res) => {
    const config = loadAiConfig();
    const { fillEngine, ocrEngine } = req.body;
    if (fillEngine) {
      if (fillEngine.endpoint !== undefined) config.fillEngine.endpoint = fillEngine.endpoint;
      if (fillEngine.model !== undefined) config.fillEngine.model = fillEngine.model;
      if (fillEngine.enabled !== undefined) config.fillEngine.enabled = fillEngine.enabled;
    }
    if (ocrEngine) {
      if (ocrEngine.provider !== undefined) config.ocrEngine.provider = ocrEngine.provider;
      if (ocrEngine.mineruEndpoint !== undefined) config.ocrEngine.mineruEndpoint = ocrEngine.mineruEndpoint;
      if (ocrEngine.paddleEndpoint !== undefined) config.ocrEngine.paddleEndpoint = ocrEngine.paddleEndpoint;
      if (ocrEngine.visionEndpoint !== undefined) config.ocrEngine.visionEndpoint = ocrEngine.visionEndpoint;
      if (ocrEngine.visionModel !== undefined) config.ocrEngine.visionModel = ocrEngine.visionModel;
      if (ocrEngine.enabled !== undefined) config.ocrEngine.enabled = ocrEngine.enabled;
    }
    saveAiConfig(config);
    res.json(config);
  })
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
        const provider = new LocalProvider({ endpoint: fillCfg.endpoint, modelName: fillCfg.model });
        const engine = new SmartFillEngine(provider);
        const items = await engine.parseFromText('测试：打车50元');
        const elapsed = Date.now() - start;
        if (items.length > 0) {
          result = `文字识别成功（${elapsed}ms），解析到 ${items.length} 条费用`;
          success = true;
        } else {
          result = `模型响应但未解析到结构化数据（${elapsed}ms）`;
        }
      } else if (type === 'ocr') {
        const pdfPath = join(process.cwd(), 'docs', 'dzfp_25362000000115126055_深圳市数恒纪元信息技术咨询企业（个人独资）_20251106105357.pdf');
        if (!existsSync(pdfPath)) {
          result = `发票样例文件不存在: ${pdfPath}`;
        } else {
          const pdfBuffer = readFileSync(pdfPath);

          if (ocrCfg.provider === 'mineru') {
            const engine = new InvoiceOCREngine(new MinerUProvider({ endpoint: ocrCfg.mineruEndpoint, apiKey: process.env.MINERU_TOKEN }));
            const ocrResult = await engine.parseInvoice(pdfBuffer, 'sample.pdf');
            result = formatOcrResult(ocrResult, Date.now() - start, 'MinerU');
            success = !!(ocrResult.invoiceNo || ocrResult.amount);
          } else if (ocrCfg.provider === 'paddle') {
            const engine = new InvoiceOCREngine(new PaddleProvider({ endpoint: ocrCfg.paddleEndpoint }));
            const ocrResult = await engine.parseInvoice(pdfBuffer, 'sample.pdf');
            result = formatOcrResult(ocrResult, Date.now() - start, 'PaddleOCR');
            success = !!(ocrResult.invoiceNo || ocrResult.amount);
          } else {
            const provider = new LocalProvider({ endpoint: ocrCfg.visionEndpoint, modelName: ocrCfg.visionModel });
            const engine = new InvoiceOCREngine(new VisionOCRProvider(provider));
            const ocrResult = await engine.parseInvoice(pdfBuffer, 'sample.pdf');
            result = formatOcrResult(ocrResult, Date.now() - start, '视觉模型');
            success = !!(ocrResult.invoiceNo || ocrResult.amount);
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

export { router as adminRoutes };
