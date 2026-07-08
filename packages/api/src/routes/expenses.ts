import { Router, Request, Response, NextFunction } from 'express';
import {
  PgExpenseRepo,
  PgInvoiceRepo,
  PgApprovalRuleRepo,
  PgApprovalRecordRepo,
  pool,
} from '@sse/db';
import { ReportService } from '@sse/core';
import { ReportStatus, InvoiceFormat, UserRole } from '@sse/shared';
import type { ExpenseQuery } from '@sse/core';
import { authMiddleware } from '@sse/auth';
import { uploadInvoice } from '../middleware/upload';
import { AppError } from '../middleware/error';
import { MinioStorage } from '../storage/minio-storage';

const router = Router();
const expenseRepo = new PgExpenseRepo();
const ruleRepo = new PgApprovalRuleRepo();
const recordRepo = new PgApprovalRecordRepo();
const invoiceRepo = new PgInvoiceRepo();
const reportService = new ReportService(expenseRepo, ruleRepo, recordRepo);
const minio = new MinioStorage();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(authMiddleware);

router.post(
  '/',
  asyncWrap(async (req, res) => {
    const dto = req.body;
    if (!dto.title || !dto.items || !Array.isArray(dto.items) || dto.items.length === 0) {
      throw new AppError(400, 'INVALID_PARAMS', '标题和费用明细不能为空');
    }

    const report = await reportService.submitReport(dto, req.user!.userId);
    res.status(201).json(report);
  })
);

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const query: ExpenseQuery = {
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      applicantId: req.query.applicantId as string | undefined,
      status: req.query.status as string | undefined,
      categoryId: req.query.categoryId as string | undefined,
      amountMin: req.query.amountMin ? Number(req.query.amountMin) : undefined,
      amountMax: req.query.amountMax ? Number(req.query.amountMax) : undefined,
      keyword: req.query.keyword as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
    };

    const { role, department, userId } = req.user!;

    let result: { results: any[]; total: number };

    if (role === UserRole.ADMIN || role === UserRole.FINANCE) {
      result = await expenseRepo.findMany(query);
    } else if (role === UserRole.DEPT_APPROVER) {
      const { rows: deptUsers } = await pool.query(
        'SELECT id FROM users WHERE department = $1',
        [department]
      );
      const deptUserIds = deptUsers.map((r: any) => r.id);

      const conditions: string[] = [];
      const values: any[] = [];
      let idx = 1;

      conditions.push(`er.user_id = ANY($${idx++})`);
      values.push(deptUserIds);

      if (query.dateFrom) { conditions.push(`er.created_at >= $${idx++}`); values.push(query.dateFrom); }
      if (query.dateTo) { conditions.push(`er.created_at <= $${idx++}`); values.push(query.dateTo); }
      if (query.applicantId) { conditions.push(`er.user_id = $${idx++}`); values.push(query.applicantId); }
      if (query.status) { conditions.push(`er.status = $${idx++}`); values.push(query.status); }
      if (query.keyword) { conditions.push(`er.title ILIKE $${idx++}`); values.push(`%${query.keyword}%`); }

      const where = `WHERE ${conditions.join(' AND ')}`;
      const page = query.page || 1;
      const pageSize = query.pageSize || 20;
      const offset = (page - 1) * pageSize;

      const [dataRes, countRes] = await Promise.all([
        pool.query(
          `SELECT er.* FROM expense_reports er ${where} ORDER BY er.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
          [...values, pageSize, offset]
        ),
        pool.query(`SELECT COUNT(*) FROM expense_reports er ${where}`, values),
      ]);

      result = {
        results: dataRes.rows.map(mapReportRow),
        total: parseInt(countRes.rows[0].count, 10),
      };
    } else {
      query.applicantId = userId;
      result = await expenseRepo.findMany(query);
    }

    res.json({
      results: result.results,
      total: result.total,
      page: query.page || 1,
      pageSize: query.pageSize || 20,
    });
  })
);

router.get(
  '/:id',
  asyncWrap(async (req, res) => {
    const report = await expenseRepo.findById(req.params.id);
    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    }

    const { role, department, userId } = req.user!;

    const { rows: ownerRows } = await pool.query(
      'SELECT department FROM users WHERE id = $1',
      [report.userId]
    );
    const ownerDept = ownerRows.length > 0 ? ownerRows[0].department : '';

    if (role === UserRole.ADMIN || role === UserRole.FINANCE) {
      // 可以查看
    } else if (role === UserRole.DEPT_APPROVER && ownerDept === department) {
      // 可以查看
    } else if (report.userId !== userId) {
      throw new AppError(403, 'UNAUTHORIZED', '无权查看此报销单');
    }

    const [itemsRes, records] = await Promise.all([
      pool.query('SELECT * FROM expense_items WHERE report_id = $1 ORDER BY expense_date', [report.id]),
      recordRepo.findByReportId(report.id),
    ]);

    const items = itemsRes.rows.map(mapItemRow);
    const itemIds = items.map((i: any) => i.id);
    let invoices: any[] = [];
    if (itemIds.length > 0) {
      const { rows: invRows } = await pool.query(
        'SELECT * FROM invoices WHERE item_id = ANY($1)',
        [itemIds]
      );
      invoices = invRows.map(mapInvoiceRow);
    }

    res.json({
      report: mapReportRow({ ...report }),
      items,
      invoices,
      approvalRecords: records,
    });
  })
);

router.put(
  '/:id',
  asyncWrap(async (req, res) => {
    const { id } = req.params;
    const { title, description, items } = req.body;

    const report = await expenseRepo.findById(id);
    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    }
    if (report.userId !== req.user!.userId) {
      throw new AppError(403, 'UNAUTHORIZED', '无权修改此报销单');
    }
    if (report.status !== ReportStatus.DRAFT) {
      throw new AppError(400, 'INVALID_PARAMS', '只能修改草稿状态的报销单');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const setClauses: string[] = [];
      const setValues: any[] = [];
      let paramIdx = 1;

      if (title !== undefined) {
        setClauses.push(`title = $${paramIdx++}`);
        setValues.push(title);
      }
      if (description !== undefined) {
        setClauses.push(`description = $${paramIdx++}`);
        setValues.push(description);
      }

      if (setClauses.length > 0) {
        setClauses.push('updated_at = NOW()');
        setValues.push(id);
        await client.query(
          `UPDATE expense_reports SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
          setValues
        );
      }

      if (items !== undefined && Array.isArray(items)) {
        await client.query('DELETE FROM expense_items WHERE report_id = $1', [id]);

        let totalAmount = 0;
        for (const item of items) {
          await client.query(
            `INSERT INTO expense_items (report_id, category_id, amount, expense_date, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, item.categoryId, item.amount, item.expenseDate, item.description || '']
          );
          totalAmount += Number(item.amount);
        }

        await client.query(
          'UPDATE expense_reports SET total_amount = $1, updated_at = NOW() WHERE id = $2',
          [totalAmount, id]
        );
      }

      await client.query('COMMIT');

      const updated = await expenseRepo.findById(id);
      res.json(updated);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

router.delete(
  '/:id',
  asyncWrap(async (req, res) => {
    const { id } = req.params;

    const report = await expenseRepo.findById(id);
    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    }
    if (report.userId !== req.user!.userId) {
      throw new AppError(403, 'UNAUTHORIZED', '无权删除此报销单');
    }
    if (report.status !== ReportStatus.DRAFT) {
      throw new AppError(400, 'INVALID_PARAMS', '只能删除草稿状态的报销单');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM invoices WHERE item_id IN (SELECT id FROM expense_items WHERE report_id = $1)', [id]);
      await client.query('DELETE FROM expense_items WHERE report_id = $1', [id]);
      await client.query('DELETE FROM approval_records WHERE report_id = $1', [id]);
      await client.query('DELETE FROM expense_reports WHERE id = $1', [id]);
      await client.query('COMMIT');
      res.json({ message: '删除成功' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

router.post(
  '/:id/items/:itemId/invoice',
  uploadInvoice.single('file'),
  asyncWrap(async (req, res) => {
    const { itemId } = req.params;

    if (!req.file) {
      throw new AppError(400, 'INVALID_PARAMS', '请上传发票文件');
    }

    const report = await expenseRepo.findById(req.params.id);
    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    }

    const { rows: itemRows } = await pool.query(
      'SELECT * FROM expense_items WHERE id = $1 AND report_id = $2',
      [itemId, req.params.id]
    );
    if (itemRows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', '费用明细不存在');
    }

    const crypto = await import('crypto');
    const checksum = minio.calculateChecksum(req.file.buffer);
    const ext = req.file.originalname.split('.').pop()?.toLowerCase() || 'pdf';
    const storageKey = `invoices/${req.params.id}/${itemId}_${Date.now()}.${ext}`;

    await minio.upload(storageKey, 'invoices', req.file.buffer, ext === 'pdf' ? 'application/pdf' : 'application/ofd');

    const invoice = await invoiceRepo.create({
      itemId,
      fileName: req.file.originalname,
      fileFormat: ext,
      fileSize: req.file.size,
      storageKey,
      storageBucket: 'invoices',
      checksum,
    });

    res.status(201).json(invoice);
  })
);

router.get(
  '/:id/items/:itemId/invoice/:invoiceId/download',
  asyncWrap(async (req, res) => {
    const inv = await invoiceRepo.findById(req.params.invoiceId);
    if (!inv) throw new AppError(404, 'NOT_FOUND', '发票不存在');

    const url = await minio.getSignedUrl(inv.storageKey, inv.storageBucket, 3600);
    res.json({ url });
  })
);

function mapReportRow(row: any) {
  return {
    id: row.id,
    serialNo: row.serial_no,
    userId: row.user_id,
    title: row.title,
    totalAmount: Number(row.total_amount),
    status: row.status,
    currentStep: row.current_step,
    submittedAt: row.submitted_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    description: row.description ?? undefined,
  };
}

function mapItemRow(row: any) {
  return {
    id: row.id,
    reportId: row.report_id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    description: row.description,
  };
}

function mapInvoiceRow(row: any) {
  return {
    id: row.id,
    itemId: row.item_id,
    fileName: row.file_name,
    fileFormat: row.file_format,
    fileSize: row.file_size,
    storageKey: row.storage_key,
    storageBucket: row.storage_bucket,
    checksum: row.checksum,
    ocrResult: row.ocr_result ?? undefined,
    uploadedAt: row.uploaded_at,
  };
}

export { router as expenseRoutes };
