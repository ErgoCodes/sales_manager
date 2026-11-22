import type { NextFunction, Request, Response } from 'express';

/**
 * Reports are private per user and permission (ADR 0004) and change with every
 * sale: no cache may keep them (spec "Cache"). Set before the guards run, so a
 * 401, 403 or 429 carries it too.
 */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}
