import { Router, Request, Response, NextFunction } from 'express';
import { PgApprovalRecordRepo, PgExpenseRepo, PgApprovalRuleRepo, PgUserRepo, PgReportSnapshotRepo, pool, withTransaction } from '@sse/db';
import { ApprovalEngine, aggregateVerificationStatus, NoApproverError } from '@sse/core';
import { ApprovalResult, ReportStatus, UserRole } from '@sse/shared';
import { expenseApprovedMessage, expenseRejectedMessage } from '@sse/notifications';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { AppError } from '../middleware/error';
import { sendNotificationSafe } from '../services/notifications';

const router = Router();
const recordRepo = new PgApprovalRecordRepo();
const ruleRepo = new PgApprovalRuleRepo();
const expenseRepo = new PgExpenseRepo();
const engine = new ApprovalEngine(ruleRepo, recordRepo);
const snapshotRepo = new PgReportSnapshotRepo();

function notifyApproved(report: { userId: string; serialNo: string; title: string }) {
  void sendNotificationSafe(
    report.userId,
    expenseApprovedMessage({ serialNo: report.serialNo, title: report.title }),
  );
}

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(authMiddleware);

router.get(
  '/pending',
  asyncWrap(async (req, res) => {
    const { role, department, userId } = req.user!;

    if (role !== UserRole.DEPT_APPROVER && role !== UserRole.FINANCE && role !== UserRole.ADMIN) {
      throw new AppError(403, 'UNAUTHORIZED', '无权查看审批列表');
    }

    let query: string;
    let values: any[];

    if (role === UserRole.ADMIN) {
      query = `
        SELECT ar.*, er.serial_no, er.title, er.total_amount, er.user_id, u.name as applicant_name, d.name AS department
        FROM approval_records ar
        JOIN expense_reports er ON er.id = ar.report_id
        JOIN users u ON u.id = er.user_id
        JOIN departments d ON d.id = u.department_id
        WHERE ar.result = $1
        ORDER BY ar.step_started_at DESC
      `;
      values = [ApprovalResult.PENDING];
    } else if (role === UserRole.FINANCE) {
      query = `
        SELECT ar.*, er.serial_no, er.title, er.total_amount, er.user_id, u.name as applicant_name, d.name AS department
        FROM approval_records ar
        JOIN expense_reports er ON er.id = ar.report_id
        JOIN users u ON u.id = er.user_id
        JOIN departments d ON d.id = u.department_id
        WHERE ar.result = $1
          AND (ar.approver_id::text = $2 OR ar.approver_id::text = $3)
        ORDER BY ar.step_started_at DESC
      `;
      values = [ApprovalResult.PENDING, userId, role];
    } else {
      query = `
        SELECT ar.*, er.serial_no, er.title, er.total_amount, er.user_id, u.name as applicant_name, d.name AS department
        FROM approval_records ar
        JOIN expense_reports er ON er.id = ar.report_id
        JOIN users u ON u.id = er.user_id
        JOIN departments d ON d.id = u.department_id
        WHERE ar.result = $1
          AND (ar.approver_id::text = $2 OR ar.approver_id::text = $3)
          AND u.department_id = (SELECT id FROM departments WHERE name = $4)
        ORDER BY ar.step_started_at DESC
      `;
      values = [ApprovalResult.PENDING, userId, role, department];
    }

    const { rows } = await pool.query(query, values);

    const items = rows.map((r: any) => ({
      id: r.id,
      reportId: r.report_id,
      step: r.step,
      approverId: r.approver_id,
      stepStartedAt: r.step_started_at,
      result: r.result,
      comment: r.comment ?? undefined,
      approvedAt: r.approved_at ?? undefined,
      serialNo: r.serial_no,
      title: r.title,
      totalAmount: Number(r.total_amount),
      userId: r.user_id,
      applicantName: r.applicant_name,
      department: r.department,
    }));

    res.json(items);
  })
);

router.post(
  '/:reportId/approve',
  asyncWrap(async (req, res) => {
    const { reportId } = req.params;
    const { comment, acknowledgeVerification } = req.body;
    const { role, department, userId } = req.user!;

    const report = await expenseRepo.findById(reportId);
    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    }

    if (role === UserRole.DEPT_APPROVER) {
      const { rows: ownerRows } = await pool.query(
        'SELECT d.name AS department FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = $1',
        [report.userId]
      );
      if (ownerRows.length === 0 || ownerRows[0].department !== department) {
        throw new AppError(403, 'UNAUTHORIZED', '无权审批该部门的报销单');
      }
    }

    const records = await recordRepo.findByReportId(reportId);
    const pendingRecord = records.find(
      (r) => r.result === ApprovalResult.PENDING &&
        (role === UserRole.ADMIN || r.approverId === userId)
    );

    if (!pendingRecord) {
      throw new AppError(400, 'INVALID_PARAMS', `没有需要你审批的步骤 ${role}`);
    }

    const { rows: verificationRows } = await pool.query(
      `SELECT i.verification_status
         FROM invoices i
         JOIN expense_items ei ON ei.id = i.item_id
        WHERE ei.report_id = $1`,
      [reportId]
    );
    const verificationStatus = aggregateVerificationStatus(
      verificationRows.map((row: any) => row.verification_status || 'pending')
    );
    const needsAcknowledgement =
      verificationStatus === 'warning' ||
      verificationStatus === 'unverified' ||
      verificationStatus === 'error';

    if (needsAcknowledgement && acknowledgeVerification !== true) {
      throw new AppError(
        409,
        'VERIFICATION_ACK_REQUIRED',
        '该报销单存在 AI 核对差异或尚未核对，请确认后再审批'
      );
    }

    const { rows: items } = await pool.query(
      'SELECT category_id FROM expense_items WHERE report_id = $1',
      [reportId]
    );
    const categoryIds = items.map((r: any) => r.category_id);

    const matchedRule = await engine.matchRule(report.totalAmount, categoryIds);
    const userRepo = new PgUserRepo();
    const reporter = await userRepo.findById(report.userId);
    const ownerDepartment = reporter?.department || '';

    let isLast = true;
    if (matchedRule) {
      if (matchedRule.approvalChain.length > 1) {
        const { effectiveChain, merged } = await engine.dedupeApprovalChain(
          matchedRule, userRepo, ownerDepartment
        );
        if (merged) {
          matchedRule.approvalChain = effectiveChain;
        }
      }

      isLast = engine.isLastStep(matchedRule, pendingRecord.step);
      if (!isLast) {
        try {
          await engine.resolveNextAssignee(
            matchedRule,
            pendingRecord.step,
            userRepo,
            ownerDepartment
          );
        } catch (error) {
          if (error instanceof NoApproverError) {
            throw new AppError(400, 'NO_APPROVER', '未找到下一审批步骤的审批人，请检查部门与角色配置');
          }
          throw error;
        }
      }
    }

    const action = {
      recordId: pendingRecord.id,
      step: pendingRecord.step,
      result: ApprovalResult.APPROVED,
      comment,
    };

    let nextStep: number | null = null;
    await withTransaction(pool, async (client) => {
      if (acknowledgeVerification === true) {
        await client.query(
          'UPDATE approval_records SET verification_acknowledged = true WHERE id = $1',
          [pendingRecord.id]
        );
      }

      await engine.approveStep(
        reportId,
        pendingRecord.step,
        ApprovalResult.APPROVED,
        comment,
        client
      );

      if (!matchedRule || isLast) {
        await expenseRepo.updateStatus(reportId, ReportStatus.APPROVED, undefined, client);
      } else {
        let nextRecord;
        try {
          nextRecord = await engine.createNextStep(
            reportId,
            matchedRule,
            pendingRecord.step,
            userRepo,
            ownerDepartment,
            client
          );
        } catch (error) {
          if (error instanceof NoApproverError) {
            throw new AppError(400, 'NO_APPROVER', '未找到下一审批步骤的审批人，请检查部门与角色配置');
          }
          throw error;
        }
        if (!nextRecord) {
          throw new AppError(400, 'NO_APPROVER', '未找到下一审批步骤的审批人，请检查部门与角色配置');
        }
        nextStep = nextRecord.step;
        await expenseRepo.updateStatus(reportId, ReportStatus.PENDING, nextRecord.step, client);
      }

      await snapshotRepo.capture(
        {
          reportId,
          snapshotType: 'approve',
          actor: { type: 'user', id: userId, role },
          rule: matchedRule,
          action,
        },
        client
      );
    });

    if (!matchedRule) {
      notifyApproved(report);
      res.json({ message: '审批成功（无匹配规则，直接通过）', result: ApprovalResult.APPROVED });
      return;
    }

    if (isLast) {
      notifyApproved(report);
      res.json({ message: '审批成功，流程结束', result: ApprovalResult.APPROVED });
      return;
    }

    res.json({ message: '审批成功，已推进至下一审批步骤', result: ApprovalResult.APPROVED, nextStep });
  })
);

router.post(
  '/:reportId/reject',
  asyncWrap(async (req, res) => {
    const { reportId } = req.params;
    const { comment } = req.body;
    const { role, department, userId } = req.user!;

    if (typeof comment !== 'string' || !comment.trim()) {
      throw new AppError(400, 'INVALID_PARAMS', '驳回时必须填写意见');
    }

    const report = await expenseRepo.findById(reportId);
    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    }

    if (role === UserRole.DEPT_APPROVER) {
      const { rows: ownerRows } = await pool.query(
        'SELECT d.name AS department FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = $1',
        [report.userId]
      );
      if (ownerRows.length === 0 || ownerRows[0].department !== department) {
        throw new AppError(403, 'UNAUTHORIZED', '无权审批该部门的报销单');
      }
    }

    const records = await recordRepo.findByReportId(reportId);
    const pendingRecord = records.find(
      (r) => r.result === ApprovalResult.PENDING &&
        (role === UserRole.ADMIN || r.approverId === userId)
    );

    if (!pendingRecord) {
      throw new AppError(400, 'INVALID_PARAMS', '没有需要你审批的步骤');
    }

    await withTransaction(pool, async (client) => {
      await engine.approveStep(
        reportId,
        pendingRecord.step,
        ApprovalResult.REJECTED,
        comment,
        client
      );
      await expenseRepo.updateStatus(reportId, ReportStatus.REJECTED, undefined, client);
      await snapshotRepo.capture(
        {
          reportId,
          snapshotType: 'reject',
          actor: { type: 'user', id: userId, role },
          rule: null,
          action: {
            recordId: pendingRecord.id,
            step: pendingRecord.step,
            result: ApprovalResult.REJECTED,
            comment,
          },
        },
        client
      );
    });

    void sendNotificationSafe(
      report.userId,
      expenseRejectedMessage({ serialNo: report.serialNo, title: report.title }, comment),
    );

    res.json({ message: '已驳回', result: ApprovalResult.REJECTED });
  })
);

export { router as approvalRoutes };
