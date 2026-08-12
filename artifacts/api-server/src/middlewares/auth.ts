import type { NextFunction, Request, Response } from "express";
import { readToken, type AuthUser, type Role } from "../lib/security";
import { pool } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  try {
    const payload = readToken(token);
    const result = await pool.query(
      `SELECT u.id, u.username, u.role, u.base_id AS "baseId",
              b.name AS "baseName", u.last_active_at AS "lastActiveAt"
       FROM users u
       LEFT JOIN bases b ON b.id = u.base_id
       WHERE u.id = $1`,
      [payload.userId],
    );
    const row = result.rows[0] as AuthUser | undefined;
    if (!row) {
      res.status(401).json({ message: "Invalid authentication" });
      return;
    }
    req.user = row;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function authorizeRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: "Insufficient authorization level" });
      return;
    }
    next();
  };
}

export function scopedBaseId(req: Request, requested?: number): number | undefined {
  if (req.user?.role !== "ADMIN") {
    return req.user?.baseId ?? undefined;
  }
  return requested;
}

export function assertBaseAccess(req: Request, res: Response, baseId: number): boolean {
  if (req.user?.role !== "ADMIN" && req.user?.baseId !== baseId) {
    res.status(403).json({ message: "Base scope violation" });
    return false;
  }
  return true;
}