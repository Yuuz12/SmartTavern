import { Router, type Request, type Response } from 'express';
import { userService, systemConfig } from '../../storage/index.js';
import { asyncHandler, ApiError, authRequired } from '../../middleware/index.js';
import { registerLimiter, loginLimiter } from '../../middleware/rateLimiter.js';
import {
  ERROR_CODES,
  logger,
  omitSensitive,
  validatePassword,
  validateUsername,
  verifyPassword,
  type User,
} from '../../shared/index.js';
import {
  generateTokenPair,
  generateAccessToken,
  refreshAccessToken,
  verifyRefreshToken,
} from './auth.service.js';

const router = Router();

/**
 * POST /api/auth/register
 * 用户注册 - 首个用户自动成为管理员
 */
router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
      throw ApiError.badRequest('用户名和密码不能为空', ERROR_CODES.VALIDATION_ERROR);
    }

    const usernameCheck = validateUsername(username);
    if (!usernameCheck.valid) {
      throw ApiError.badRequest(usernameCheck.message!, ERROR_CODES.VALIDATION_ERROR);
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      throw ApiError.badRequest(passwordCheck.message!, ERROR_CODES.VALIDATION_ERROR);
    }

    // 检查注册开关（首个用户注册时自动跳过，确保初始管理员可创建）
    const userCount = await userService.count();
    if (userCount > 0 && !systemConfig.get().registrationEnabled) {
      throw ApiError.forbidden('管理员已关闭注册功能');
    }

    // 检查用户名是否已存在
    const existing = await userService.findByUsername(username);
    if (existing) {
      throw ApiError.conflict('用户名已存在');
    }

    const user = await userService.createUser(username, password);
    const tokens = generateTokenPair(user);

    logger.info('用户注册成功', { userId: user.id, username });

    res.status(201).json({
      success: true,
      data: {
        user: omitSensitive(user as unknown as Record<string, unknown>),
        ...tokens,
      },
    });
  }),
);

/**
 * POST /api/auth/login
 * 用户登录
 */
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
      throw ApiError.badRequest('用户名和密码不能为空');
    }

    const user = await userService.findByUsername(username);
    if (!user) {
      throw ApiError.unauthorized('用户名或密码错误', ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw ApiError.unauthorized('用户名或密码错误', ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }

    const tokens = generateTokenPair(user);

    logger.info('用户登录成功', { userId: user.id, username });

    res.json({
      success: true,
      data: {
        user: omitSensitive(user as unknown as Record<string, unknown>),
        mustChangePassword: user.mustChangePassword === true,
        ...tokens,
      },
    });
  }),
);

/**
 * POST /api/auth/logout
 * 用户登出 - 客户端清除 token 即可
 */
router.post('/logout', authRequired, (_req: Request, res: Response) => {
  res.json({ success: true, data: { message: '已登出' } });
});

/**
 * POST /api/auth/refresh
 * 刷新 Access Token
 */
router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw ApiError.badRequest('Refresh Token 不能为空');
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      throw ApiError.unauthorized('Refresh Token 无效或已过期', ERROR_CODES.AUTH_TOKEN_EXPIRED);
    }

    const newAccessToken = generateAccessToken({
      id: payload.userId,
      username: payload.username,
      role: payload.role,
    } as User);

    res.json({
      success: true,
      data: { accessToken: newAccessToken },
    });
  }),
);

/**
 * GET /api/auth/me
 * 获取当前登录用户信息
 */
router.get(
  '/me',
  authRequired,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }
    const user = await userService.get(req.user.userId);
    if (!user) {
      throw ApiError.notFound('用户不存在');
    }
    res.json({
      success: true,
      data: {
        ...omitSensitive(user as unknown as Record<string, unknown>),
        mustChangePassword: user.mustChangePassword === true,
      },
    });
  }),
);

/**
 * PUT /api/auth/password
 * 修改密码（需验证原密码）
 */
router.put(
  '/password',
  authRequired,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      throw ApiError.badRequest('原密码和新密码不能为空');
    }

    const user = await userService.get(req.user.userId);
    if (!user) throw ApiError.notFound('用户不存在');

    const isValid = await verifyPassword(oldPassword, user.passwordHash);
    if (!isValid) {
      throw ApiError.unauthorized('原密码错误', ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      throw ApiError.badRequest(passwordCheck.message!, ERROR_CODES.VALIDATION_ERROR);
    }

    await userService.updatePassword(user.id, newPassword);
    // 清除强制改密标记
    await userService.update(user.id, { mustChangePassword: false });
    logger.info('用户修改密码', { userId: user.id });

    res.json({ success: true, data: { message: '密码修改成功' } });
  }),
);

/**
 * PUT /api/auth/force-password
 * 强制修改密码（首次登录，无需原密码，仅 mustChangePassword=true 时可用）
 */
router.put(
  '/force-password',
  authRequired,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { newPassword } = req.body;
    if (!newPassword) {
      throw ApiError.badRequest('新密码不能为空');
    }

    const user = await userService.get(req.user.userId);
    if (!user) throw ApiError.notFound('用户不存在');

    if (!user.mustChangePassword) {
      throw ApiError.forbidden('无需强制修改密码');
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      throw ApiError.badRequest(passwordCheck.message!, ERROR_CODES.VALIDATION_ERROR);
    }

    await userService.updatePassword(user.id, newPassword);
    await userService.update(user.id, { mustChangePassword: false });
    logger.info('用户强制修改密码（首次登录）', { userId: user.id });

    res.json({ success: true, data: { message: '密码修改成功' } });
  }),
);

export default router;
