import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function signToken(payload: {
  userId: string;
  role: string;
  department: string;
}): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(
  token: string
): { userId: string; role: string; department: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (decoded.type === 'refresh') return null;
    if (!decoded.userId || !decoded.role || !decoded.department) return null;
    return { userId: decoded.userId, role: decoded.role, department: decoded.department };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (decoded.type !== 'refresh' || !decoded.userId) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}

export function generateMcpApiKey(): string {
  return 'mcp_' + crypto.randomBytes(24).toString('hex');
}
