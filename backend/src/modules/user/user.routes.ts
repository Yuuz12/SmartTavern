import { Router, type Request, type Response } from 'express';
import fs from 'fs-extra';
import path from 'path';
import {
  userService,
  characterService,
  worldbookService,
  conversationService,
} from '../../storage/index.js';
import { storageConfig } from '../../config/index.js';
import { authRequired, adminRequired, asyncHandler, ApiError } from '../../middleware/index.js';
import { ERROR_CODES, logger, omitSensitive, validateUsername, type UserRole } from '../../shared/index.js';

const router = Router();

/**
 * GET /api/users
 * 获取用户列表（仅管理员），支持分页与搜索
 */
router.get(
  '/',
  authRequired,
  adminRequired,
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.max(1, parseInt(req.query.pageSize as string, 10) || 50);
    const search = req.query.search as string | undefined;

    const allUsers = await userService.query((u) => {
      if (!search) return true;
      return u.username.toLowerCase().includes(search.toLowerCase());
    });

    const total = allUsers.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = allUsers
      .slice(start, start + pageSize)
      .map((u) => omitSensitive(u as unknown as Record<string, unknown>));

    res.json({
      success: true,
      data: { items, total, page, pageSize, totalPages },
    });
  }),
);

/**
 * POST /api/users/create
 * 管理员创建新用户（仅需用户名，使用默认密码，首次登录必须改密）
 */
router.post(
  '/create',
  authRequired,
  adminRequired,
  asyncHandler(async (req: Request, res: Response) => {
    const { username } = req.body;

    if (!username) {
      throw ApiError.badRequest('用户名不能为空', ERROR_CODES.VALIDATION_ERROR);
    }

    const usernameCheck = validateUsername(username);
    if (!usernameCheck.valid) {
      throw ApiError.badRequest(usernameCheck.message!, ERROR_CODES.VALIDATION_ERROR);
    }

    // 检查用户名是否已存在
    const existing = await userService.findByUsername(username);
    if (existing) {
      throw ApiError.conflict('用户名已存在');
    }

    // 使用默认密码创建用户，标记必须修改密码
    const defaultPassword = 'Abc123456';
    const user = await userService.createUser(username, defaultPassword);
    await userService.update(user.id, { mustChangePassword: true });

    logger.info('管理员创建用户', { userId: user.id, username, createdBy: req.user?.userId });

    res.status(201).json({
      success: true,
      data: {
        ...omitSensitive(user as unknown as Record<string, unknown>),
        mustChangePassword: true,
        defaultPassword,
      },
    });
  }),
);

/**
 * GET /api/users/:id
 * 获取用户信息（只能查自己或管理员）
 */
router.get(
  '/:id',
  authRequired,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    if (req.user.userId !== id && req.user.role !== 'admin') {
      throw ApiError.forbidden('无权访问该资源');
    }

    const user = await userService.get(id);
    if (!user) throw ApiError.notFound('用户不存在');

    res.json({
      success: true,
      data: omitSensitive(user as unknown as Record<string, unknown>),
    });
  }),
);

/**
 * PUT /api/users/:id
 * 更新用户信息（用户名、头像、settings，只能改自己）
 */
router.put(
  '/:id',
  authRequired,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    if (req.user.userId !== id) {
      throw ApiError.forbidden('无权修改该资源');
    }

    const user = await userService.get(id);
    if (!user) throw ApiError.notFound('用户不存在');

    const { username, avatar, settings } = req.body;

    if (username !== undefined && typeof username !== 'string') {
      throw ApiError.badRequest('用户名必须为字符串');
    }
    if (username && username !== user.username) {
      const existing = await userService.findByUsername(username);
      if (existing && existing.id !== id) {
        throw ApiError.conflict('用户名已存在');
      }
    }

    const updated = await userService.updateProfile(id, {
      ...(username !== undefined ? { username } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
      ...(settings !== undefined ? { settings } : {}),
    });

    logger.info('用户信息更新', { userId: id });

    res.json({
      success: true,
      data: omitSensitive(updated as unknown as Record<string, unknown>),
    });
  }),
);

/**
 * DELETE /api/users/:id
 * 删除用户（仅管理员），级联删除其角色卡、世界书、对话
 */
router.delete(
  '/:id',
  authRequired,
  adminRequired,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const user = await userService.get(id);
    if (!user) throw ApiError.notFound('用户不存在');

    // 级联删除：直接移除用户数据文件夹（角色卡/世界书/对话）
    const userDir = path.join(storageConfig.dataPath, 'users', id);
    await fs.remove(userDir);
    // 清理各 service 的内存缓存
    await Promise.all([
      characterService.deleteAllByUserId(id),
      worldbookService.deleteAllByUserId(id),
      conversationService.deleteAllByUserId(id),
    ]);

    // 最后删除用户
    await userService.delete(id);

    logger.info('用户删除（含级联）', { userId: id });

    res.json({ success: true, data: { message: '用户已删除' } });
  }),
);

/**
 * PUT /api/users/:id/role
 * 修改用户角色（仅管理员）
 */
router.put(
  '/:id/role',
  authRequired,
  adminRequired,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      throw ApiError.badRequest('角色不能为空');
    }
    if (role !== 'admin' && role !== 'user') {
      throw ApiError.badRequest('角色无效，必须为 admin 或 user');
    }

    const existing = await userService.get(id);
    if (!existing) throw ApiError.notFound('用户不存在');

    const updated = await userService.updateRole(id, role as UserRole);

    logger.info('用户角色更新', { userId: id, role });

    res.json({
      success: true,
      data: omitSensitive(updated as unknown as Record<string, unknown>),
    });
  }),
);

/**
 * GET /api/users/:id/regex
 * 获取用户的正则脚本列表
 */
router.get(
  '/:id/regex',
  authRequired,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.userId !== req.params.id) {
      throw ApiError.forbidden('无权访问该资源');
    }
    const user = await userService.get(req.params.id);
    if (!user) throw ApiError.notFound('用户不存在');
    res.json({ success: true, data: user.regexScripts || [] });
  }),
);

/**
 * PUT /api/users/:id/regex
 * 整体更新用户的正则脚本列表
 */
router.put(
  '/:id/regex',
  authRequired,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.userId !== req.params.id) {
      throw ApiError.forbidden('无权修改该资源');
    }
    const { scripts } = req.body;
    if (!Array.isArray(scripts)) {
      throw ApiError.badRequest('scripts 必须为数组');
    }
    const updated = await userService.update(req.params.id, { regexScripts: scripts });
    if (!updated) throw ApiError.notFound('用户不存在');
    res.json({ success: true, data: updated.regexScripts || [] });
  }),
);

export default router;
