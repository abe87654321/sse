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
  MAX_PASSWORD_BYTES,
  isBcryptHash,
  hashPassword,
  dummyPasswordHash,
  verifyPassword,
  validatePassword,
} from './password';
