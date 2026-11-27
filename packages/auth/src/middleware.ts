import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt';

export type PrincipalExtra = {
  approverDepartments?: string[];
};

type PrincipalLoader = (userId: string) => Promise<PrincipalExtra>;

let principalLoader: PrincipalLoader | null = null;

/**
 * Lets the API enrich the JWT principal with values that must take effect
 * immediately (e.g. department approver assignments). The auth package stays
 * free of database dependencies; the API registers the loader at startup.
 */
export function setPrincipalLoader(loader: PrincipalLoader | null): void {
  principalLoader = loader;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: string;
        department: string;
        approverDepartments?: string[];
      };
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if (principalLoader) {
    try {
      const extra = await principalLoader(payload.userId);
      req.user = { ...payload, ...extra };
    } catch {
      // Fail closed for approver scope: an unresolved assignment must not grant
      // a stale department.
      req.user = { ...payload, approverDepartments: [] };
    }
  } else {
    req.user = payload;
  }

  next();
}
