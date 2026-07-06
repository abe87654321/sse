import { Router, Request, Response, NextFunction } from 'express';
import { PgUserRepo, PgApprovalRuleRepo, pool } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@sse/shared';
import { AppError } from '../middleware/error';

const router = Router();
const userRepo = new PgUserRepo();
const ruleRepo = new PgApprovalRuleRepo();

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
  asyncWrap(async (_req, res) => {
    const users = await userRepo.findAll();
    res.json(users);
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
      `INSERT INTO users (name, phone, email, department, role, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING *`,
      [name, phone, email || null, department, role]
    );

    res.status(201).json(mapUserRow(rows[0]));
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
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`,
      values
    );

    res.json(mapUserRow(rows[0]));
  })
);

router.delete(
  '/users/:id',
  asyncWrap(async (req, res) => {
    const { id } = req.params;

    const user = await userRepo.findById(id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', '用户不存在');
    }

    await pool.query(
      "UPDATE users SET status = 'disabled', updated_at = NOW() WHERE id = $1",
      [id]
    );

    res.json({ message: '用户已禁用' });
  })
);

// ========== 费用类别管理 ==========

router.get(
  '/categories',
  asyncWrap(async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM expense_categories ORDER BY name'
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { router as adminRoutes };
