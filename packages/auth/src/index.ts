export {
  signToken,
  signRefreshToken,
  verifyToken,
  verifyRefreshToken,
  generateMcpApiKey,
} from './jwt';

export {
  getPermissions,
  canViewReport,
  canWriteReport,
  resolveDataScope,
  ROLE_PERMISSIONS,
} from './rbac';

export type { Permission, DataScope } from './rbac';

export { checkRateLimit, pruneRateLimitStore } from './rate-limit';
export type { RateLimitOptions, RateLimitResult, RateLimitWindow } from './rate-limit';

export { authMiddleware } from './middleware';

export {
  BCRYPT_ROUNDS,
  isBcryptHash,
  hashPassword,
  verifyPassword,
  validatePassword,
} from './password';
