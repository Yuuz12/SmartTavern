import type { Request, Response, NextFunction } from 'express';
import { ERROR_CODES, logger } from '../shared/index.js';

/**
 * 自定义 API 错误
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static notFound(message = '资源不存在', details?: unknown): ApiError {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, message, details);
  }

  static badRequest(message = '请求参数错误', code: string = ERROR_CODES.INVALID_INPUT, details?: unknown): ApiError {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(message = '未授权', code: string = ERROR_CODES.AUTH_UNAUTHORIZED): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(message = '禁止访问'): ApiError {
    return new ApiError(403, ERROR_CODES.AUTH_FORBIDDEN, message);
  }

  static conflict(message = '资源冲突'): ApiError {
    return new ApiError(409, ERROR_CODES.CONFLICT, message);
  }

  static internal(message = '服务器内部错误', details?: unknown): ApiError {
    return new ApiError(500, ERROR_CODES.INTERNAL_ERROR, message, details);
  }
}

/**
 * 404 处理
 */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: ERROR_CODES.NOT_FOUND, message: '接口不存在' },
  });
}

/**
 * 全局错误处理
 */
export function errorHandler(
  err: Error & { code?: string; statusCode?: number },
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  logger.error('未处理的错误', { error: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: '服务器内部错误',
    },
  });
}

/**
 * 异步错误捕获包装器
 */
export function asyncHandler<T extends Request, R extends Response>(
  fn: (req: T, res: R, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: R, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
