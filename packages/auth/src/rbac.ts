import { UserRole } from '@sse/shared';

export interface Permission {
  canSubmit: boolean;
  canApprove: boolean;
  canFinalize: boolean;
  canExport: boolean;
  canManageUsers: boolean;
  canManageRules: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRole, Permission> = {
  [UserRole.EMPLOYEE]: {
    canSubmit: true,
    canApprove: false,
    canFinalize: false,
    canExport: false,
    canManageUsers: false,
    canManageRules: false,
  },
  [UserRole.DEPT_APPROVER]: {
    canSubmit: true,
    canApprove: true,
    canFinalize: false,
    canExport: false,
    canManageUsers: false,
    canManageRules: false,
  },
  [UserRole.FINANCE]: {
    canSubmit: true,
    canApprove: false,
    canFinalize: true,
    canExport: true,
    canManageUsers: false,
    canManageRules: false,
  },
  [UserRole.ADMIN]: {
    canSubmit: true,
    canApprove: true,
    canFinalize: true,
    canExport: true,
    canManageUsers: true,
    canManageRules: true,
  },
};

export function getPermissions(role: UserRole): Permission {
  return ROLE_PERMISSIONS[role];
}

export function canViewReport(
  viewerRole: UserRole,
  viewerDept: string,
  ownerDept: string,
  ownerId: string,
  viewerId: string
): boolean {
  if (viewerRole === UserRole.ADMIN || viewerRole === UserRole.FINANCE) return true;
  // An approver without a department must not match owners that also lack one.
  if (viewerRole === UserRole.DEPT_APPROVER) return !!viewerDept && viewerDept === ownerDept;
  return !!ownerId && ownerId === viewerId;
}

/**
 * Data scope for list/aggregate queries. Unlike ad-hoc role checks, unknown
 * roles fail closed (`deny`) instead of falling through to company-wide data.
 */
export type DataScope =
  | { kind: 'all' }
  | { kind: 'department'; department: string }
  | { kind: 'self'; userId: string }
  | { kind: 'deny' };

export function resolveDataScope(viewer: {
  role: string;
  userId: string;
  department?: string;
}): DataScope {
  switch (viewer.role) {
    case UserRole.ADMIN:
    case UserRole.FINANCE:
      return { kind: 'all' };
    case UserRole.DEPT_APPROVER:
      return viewer.department
        ? { kind: 'department', department: viewer.department }
        : { kind: 'deny' };
    case UserRole.EMPLOYEE:
      return viewer.userId ? { kind: 'self', userId: viewer.userId } : { kind: 'deny' };
    default:
      return { kind: 'deny' };
  }
}

/**
 * Write access to a report and its attachments. Department approvers are
 * read-only for other people's reports; they may still write their own.
 */
export function canWriteReport(
  viewerRole: UserRole,
  viewerId: string,
  ownerId: string
): boolean {
  if (viewerRole === UserRole.ADMIN || viewerRole === UserRole.FINANCE) return true;
  return !!viewerId && viewerId === ownerId;
}
