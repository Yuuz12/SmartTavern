import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { appConfig } from '../config/index.js';
import { ERROR_CODES } from '../shared/index.js';

// 开发环境禁用限流（生产环境启用）
const isDev = appConfig.isDev;

// 透传中间件（开发环境使用）
const passthrough: RequestHandler = (_req, _res, next) => next();

/**
 * 全局限流
 * - 生产环境：按配置限流
 * - 开发环境：不限制
 */
export const globalLimiter: RequestHandler = isDev
  ? passthrough
  : rateLimit({
      windowMs: appConfig.rateLimitWindowMs,
      max: appConfig.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: {
          code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
          message: '请求过于频繁，请稍后再试',
        },
      },
    });

/**
 * 登录限流
 * - 生产环境：15 分钟 5 次
 * - 开发环境：不限制
 */
export const loginLimiter: RequestHandler = isDev
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: {
          code: ERROR_CODES.AUTH_ACCOUNT_LOCKED,
          message: '登录失败次数过多，请 15 分钟后再试',
        },
      },
    });

/**
 * 注册限流
 * - 生产环境：1 小时 10 次
 * - 开发环境：不限制
 */
export const registerLimiter: RequestHandler = isDev
  ? passthrough
  : rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: {
          code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
          message: '注册请求过于频繁，请稍后再试',
        },
      },
    });
