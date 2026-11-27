import type { ApproverDepartment, DepartmentApprover } from '@sse/shared';

/**
 * Department approver assignments. One department has exactly one approver;
 * a user may be the approver for several departments.
 */
export interface IApproverAssignmentRepo {
  /** Approver user id for a department id, or null when unassigned. */
  findApproverIdForDepartment(departmentId: string): Promise<string | null>;
  /** Approver user id for a department name, or null when unassigned. */
  findApproverIdForDepartmentName(departmentName: string): Promise<string | null>;
  /** Earliest-created active administrator, used when a department has no approver. */
  findFallbackAdminId(): Promise<string | null>;
  /** Departments the user is an approver for. */
  findDepartmentsForUser(userId: string): Promise<ApproverDepartment[]>;
  /** All department -> approver assignments (admin view). */
  listAssignments(): Promise<DepartmentApprover[]>;
  /** Upsert one department's approver. */
  assign(departmentId: string, userId: string, assignedBy?: string): Promise<void>;
  /** Remove a department's approver. */
  unassign(departmentId: string): Promise<void>;
  /** Replace the full set of departments a user approves. */
  replaceForUser(userId: string, departmentIds: string[], assignedBy?: string): Promise<void>;
}
