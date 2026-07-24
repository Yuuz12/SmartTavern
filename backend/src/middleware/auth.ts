import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authConfig } from '../config/index.js';
import { ERROR_CODES, type JwtPayload } from '../shared/index.js';

// 扩展 Request 类型，挂载用户信息
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * JWT 认证中间件
 */
export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: ERROR_CODES.AUTH_TOKEN_INVALID, message: '未提供认证令牌' },
    });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
    if (payload.type && payload.type !== 'access') {
      res.status(401).json({
        success: false,
        error: { code: ERROR_CODES.AUTH_TOKEN_INVALID, message: '令牌类型无效' },
      });
      return;
    }
    req.user = payload;
    next();
  } catch (err) {
    const message = err instanceof jwt.TokenExpiredError
      ? '令牌已过期'
      : '令牌无效';
    res.status(401).json({
      success: false,
      error: { code: ERROR_CODES.AUTH_TOKEN_EXPIRED, message },
    });
  }
}

/**
 * 可选认证（未登录也可访问，但会尝试解析用户）
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
      req.user = payload;
    } catch {
      // 忽略错误
    }
  }
  next();
}

/**
 * 管理员权限校验
 */
export function adminRequired(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '未登录' },
    });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({
      success: false,
      error: { code: ERROR_CODES.AUTH_FORBIDDEN, message: '需要管理员权限' },
    });
    return;
  }
  next();
}
