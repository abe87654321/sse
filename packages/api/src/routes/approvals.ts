import { Router, Request, Response, NextFunction } from 'express';
import { PgApprovalRecordRepo, PgExpenseRepo, PgApprovalRuleRepo, pool } from '@sse/db';
import { ApprovalEngine } from '@sse/core';
import { ApprovalResult, ReportStatus, UserRole } from '@sse/shared';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { AppError } from '../middleware/error';

const router = Router();
const recordRepo = new PgApprovalRecordRepo();
const ruleRepo = new PgApprovalRuleRepo();
const expenseRepo = new PgExpenseRepo();
const engine = new ApprovalEngine(ruleRepo, recordRepo);

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(authMiddleware);

router.get(
  '/pending',
  asyncWrap(async (req, res) => {
    const { role, department } = req.user!;

    if (role !== UserRole.DEPT_APPROVER && role !== UserRole.ADMIN) {
      throw new AppError(403, 'UNAUTHORIZED', '无权查看审批列表');
    }

    let query: string;
    let values: any[];

    if (role === UserRole.ADMIN) {
      query = `
        SELECT ar.*, er.serial_no, er.title, er.total_amount, er.user_id, u.name as applicant_name, u.department
        FROM approval_records ar
        JOIN expense_reports er ON er.id = ar.report_id
        JOIN users u ON u.id = er.user_id
        WHERE ar.result = $1
        ORDER BY ar.step_started_at DESC
      `;
      values = [ApprovalResult.PENDING];
    } else {
      query = `
        SELECT ar.*, er.serial_no, er.title, er.total_amount, er.user_id, u.name as applicant_name, u.department
        FROM approval_records ar
        JOIN expense_reports er ON er.id = ar.report_id
        JOIN users u ON u.id = er.user_id
        WHERE ar.result = $1
          AND ar.approver_id = $2
          AND u.department = $3
        ORDER BY ar.step_started_at DESC
      `;
      values = [ApprovalResult.PENDING, role, department];
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
    const { comment } = req.body;
    const { role, department } = req.user!;

    const report = await expenseRepo.findById(reportId);
    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    }

    if (role === UserRole.DEPT_APPROVER) {
      const { rows: ownerRows } = await pool.query(
        'SELECT department FROM users WHERE id = $1',
        [report.userId]
      );
      if (ownerRows.length === 0 || ownerRows[0].department !== department) {
        throw new AppError(403, 'UNAUTHORIZED', '无权审批该部门的报销单');
      }
    }

    const records = await recordRepo.findByReportId(reportId);
    const pendingRecord = records.find(
      (r) => r.result === ApprovalResult.PENDING && r.approverId === role
    );

    if (!pendingRecord) {
      throw new AppError(400, 'INVALID_PARAMS', `没有需要你审批的步骤: ${role}`);
    }

    await engine.approveStep(
      reportId,
      pendingRecord.step,
      role,
      ApprovalResult.APPROVED,
      comment
    );

    // 检查是否还有后续步骤，如果没有则标记为已通过
    const rule = await ruleRepo.findActive();
    const matchingRule = rule.find((r) => {
      const steps = r.approvalChain.map((s) => s.role);
      return steps.includes(pendingRecord.approverId);
    });

    // 简单处理：如果有用匹配的规则且存在后面的步骤且已通过，推进状态
    const updatedRecords = await recordRepo.findByReportId(reportId);
    const allApproved = updatedRecords.every((r) => r.result === ApprovalResult.APPROVED);

    if (allApproved) {
      await expenseRepo.updateStatus(reportId, ReportStatus.APPROVED, report.currentStep);
    }

    res.json({ message: '审批成功', result: ApprovalResult.APPROVED });
  })
);

router.post(
  '/:reportId/reject',
  asyncWrap(async (req, res) => {
    const { reportId } = req.params;
    const { comment } = req.body;
    const { role, department } = req.user!;

    if (!comment) {
      throw new AppError(400, 'INVALID_PARAMS', '驳回时必须填写意见');
    }

    const report = await expenseRepo.findById(reportId);
    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    }

    if (role === UserRole.DEPT_APPROVER) {
      const { rows: ownerRows } = await pool.query(
        'SELECT department FROM users WHERE id = $1',
        [report.userId]
      );
      if (ownerRows.length === 0 || ownerRows[0].department !== department) {
        throw new AppError(403, 'UNAUTHORIZED', '无权审批该部门的报销单');
      }
    }

    const records = await recordRepo.findByReportId(reportId);
    const pendingRecord = records.find(
      (r) => r.result === ApprovalResult.PENDING && r.approverId === role
    );

    if (!pendingRecord) {
      throw new AppError(400, 'INVALID_PARAMS', '没有需要你审批的步骤');
    }

    await engine.approveStep(
      reportId,
      pendingRecord.step,
      role,
      ApprovalResult.REJECTED,
      comment
    );

    await expenseRepo.updateStatus(reportId, ReportStatus.REJECTED);

    res.json({ message: '已驳回', result: ApprovalResult.REJECTED });
  })
);

export { router as approvalRoutes };
