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
  if (viewerRole === UserRole.DEPT_APPROVER) return viewerDept === ownerDept;
  return ownerId === viewerId;
}
