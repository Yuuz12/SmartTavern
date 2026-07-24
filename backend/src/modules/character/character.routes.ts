import { Router, type Request, type Response } from 'express';
import { characterService } from '../../storage/index.js';
import { authRequired, asyncHandler, ApiError } from '../../middleware/index.js';
import { logger, type Character } from '../../shared/index.js';

const router = Router();

// 所有角色卡路由都需要登录
router.use(authRequired);

/**
 * GET /api/characters
 * 获取当前用户的角色卡列表，支持 ?search&tag
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const search = req.query.search as string | undefined;
    const tag = req.query.tag as string | undefined;

    const list = await characterService.getByUserId(req.user.userId, { search, tag });
    res.json({ success: true, data: list });
  }),
);

/**
 * GET /api/characters/:id/export
 * 导出角色卡（SillyTavern v2 格式）
 * 放在 /:id 之前以避免路径冲突
 */
router.get(
  '/:id/export',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const owned = await characterService.checkOwnership(id, req.user.userId);
    if (!owned) throw ApiError.forbidden('无权访问该资源');

    const exported = await characterService.exportCharacter(id, req.user.userId);
    res.json({ success: true, data: exported });
  }),
);

/**
 * GET /api/characters/:id
 * 获取角色卡详情
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const character = await characterService.get(id, req.user.userId);
    if (!character) throw ApiError.notFound('角色卡不存在');

    res.json({ success: true, data: character });
  }),
);

/**
 * POST /api/characters
 * 创建角色卡
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { name } = req.body;

    if (!name) throw ApiError.badRequest('角色卡名称不能为空');

    const character = await characterService.createCharacter(req.user.userId, req.body);

    logger.info('角色卡创建', { characterId: character.id, userId: req.user.userId });

    res.status(201).json({ success: true, data: character });
  }),
);

/**
 * POST /api/characters/import
 * 导入 SillyTavern 角色卡（v1/v2 格式）
 */
router.post(
  '/import',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!req.body || typeof req.body !== 'object') {
      throw ApiError.badRequest('请求体必须为角色卡 JSON 对象');
    }

    const character = await characterService.importCharacter(
      req.user.userId,
      req.body as Record<string, unknown>,
    );

    logger.info('角色卡导入', { characterId: character.id, userId: req.user.userId });

    res.status(201).json({ success: true, data: character });
  }),
);

/**
 * PUT /api/characters/:id
 * 更新角色卡
 */
router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const owned = await characterService.checkOwnership(id, req.user.userId);
    if (!owned) throw ApiError.forbidden('无权访问该资源');

    const updated = await characterService.updateCharacter(id, req.user.userId, req.body as Partial<Character>);

    logger.info('角色卡更新', { characterId: id, userId: req.user.userId });

    res.json({ success: true, data: updated });
  }),
);

/**
 * DELETE /api/characters/:id
 * 删除角色卡
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const owned = await characterService.checkOwnership(id, req.user.userId);
    if (!owned) throw ApiError.forbidden('无权访问该资源');

    await characterService.delete(id, req.user.userId);

    logger.info('角色卡删除', { characterId: id, userId: req.user.userId });

    res.json({ success: true, data: { message: '角色卡已删除' } });
  }),
);

export default router;
