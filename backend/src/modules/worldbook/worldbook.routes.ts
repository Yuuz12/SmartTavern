import { Router, type Request, type Response } from 'express';
import { worldbookService } from '../../storage/index.js';
import { authRequired, asyncHandler, ApiError } from '../../middleware/index.js';
import { logger, type WorldbookEntry } from '../../shared/index.js';

const router = Router();

// 所有世界书路由都需要登录
router.use(authRequired);

/**
 * GET /api/worldbooks
 * 获取当前用户的世界书列表，支持 ?search
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const search = req.query.search as string | undefined;

    const list = await worldbookService.getByUserId(req.user.userId, search);
    res.json({ success: true, data: list });
  }),
);

/**
 * GET /api/worldbooks/:id/export
 * 导出世界书
 * 放在 /:id 之前以避免路径冲突
 */
router.get(
  '/:id/export',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const wb = await worldbookService.get(id, req.user.userId);
    if (!wb) throw ApiError.notFound('世界书不存在');

    res.json({ success: true, data: wb });
  }),
);

/**
 * GET /api/worldbooks/:id
 * 获取世界书详情
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const wb = await worldbookService.get(id, req.user.userId);
    if (!wb) throw ApiError.notFound('世界书不存在');

    res.json({ success: true, data: wb });
  }),
);

/**
 * POST /api/worldbooks
 * 创建世界书
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { name, description, settings, entries } = req.body;

    if (!name) throw ApiError.badRequest('世界书名称不能为空');

    const wb = await worldbookService.createWorldbook(req.user.userId, {
      name,
      description,
      settings,
      entries,
    });

    logger.info('世界书创建', { worldbookId: wb.id, userId: req.user.userId });

    res.status(201).json({ success: true, data: wb });
  }),
);

/**
 * 规范化世界书数据
 * 兼容 SillyTavern 世界书 JSON 格式（entries 为对象/字典），
 * 转换为后端期望的数组格式。
 */
function normalizeWorldbookData(data: {
  name: unknown;
  description?: unknown;
  settings?: unknown;
  entries?: unknown;
}): {
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
  entries: WorldbookEntry[];
} {
  const source = data as {
    name: string;
    description?: string;
    settings?: Record<string, unknown>;
    entries?: unknown;
  };
  const { name, description, settings, entries } = source;

  // entries 为空：返回空数组
  if (entries == null) {
    return { name, description, settings, entries: [] };
  }

  // 已经是数组：直接使用（假定已是正确格式）
  if (Array.isArray(entries)) {
    return { name, description, settings, entries: entries as WorldbookEntry[] };
  }

  // 是对象（SillyTavern 格式）：转换为数组
  if (typeof entries === 'object') {
    const rawEntries = Object.values(entries as Record<string, Record<string, unknown>>);
    const normalizedEntries: WorldbookEntry[] = rawEntries.map((entry, index) => {
      // position: 数字 0 → 'before'，1 → 'after'；字符串保持不变
      let position: 'before' | 'after' = 'before';
      if (typeof entry.position === 'number') {
        position = entry.position === 1 ? 'after' : 'before';
      } else if (entry.position === 'before' || entry.position === 'after') {
        position = entry.position;
      }

      // uid: 数字 → 字符串；若不存在则生成
      const uid =
        entry.uid != null ? String(entry.uid) : `entry_${index}`;

      // disable → enabled（取反）
      const enabled: boolean =
        typeof entry.disable === 'boolean'
          ? !entry.disable
          : typeof entry.enabled === 'boolean'
            ? entry.enabled
            : true;

      // keys / secondaryKeys 确保是数组（兼容两种格式）
      const keys = Array.isArray(entry.keys)
        ? (entry.keys as string[])
        : Array.isArray(entry.key)
          ? (entry.key as string[])
          : [];

      const secondaryKeys = Array.isArray(entry.secondaryKeys)
        ? (entry.secondaryKeys as string[])
        : Array.isArray(entry.keysecondary)
          ? (entry.keysecondary as string[])
          : [];

      const normalized: WorldbookEntry = {
        uid,
        keys,
        secondaryKeys,
        content: typeof entry.content === 'string' ? entry.content : '',
        comment: typeof entry.comment === 'string' ? entry.comment : undefined,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        enabled,
        insertionOrder:
          typeof entry.insertionOrder === 'number'
            ? entry.insertionOrder
            : typeof entry.order === 'number'
              ? entry.order
              : 100,
        caseSensitive: typeof entry.caseSensitive === 'boolean' ? entry.caseSensitive : false,
        priority: typeof entry.priority === 'number' ? entry.priority : 10,
        id: index + 1,
        selective: typeof entry.selective === 'boolean' ? entry.selective : false,
        constant: typeof entry.constant === 'boolean' ? entry.constant : false,
        position,
        extensions:
          entry.extensions && typeof entry.extensions === 'object'
            ? (entry.extensions as Record<string, unknown>)
            : {},
      };
      return normalized;
    });

    return { name, description, settings, entries: normalizedEntries };
  }

  // 其他类型：返回空数组
  return { name, description, settings, entries: [] };
}

/**
 * POST /api/worldbooks/import
 * 导入世界书 JSON
 */
router.post(
  '/import',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!req.body || typeof req.body !== 'object') {
      throw ApiError.badRequest('请求体必须为世界书 JSON 对象');
    }

    // SillyTavern 导出的世界书 JSON 通常只有 entries 字段，name 缺失时使用默认值
    // 前端会优先用文件名填充 name，这里作为兜底
    if (!req.body.name) {
      req.body.name = '未命名世界书';
    }

    // 兼容 SillyTavern 世界书格式（entries 为对象）与后端期望的数组格式
    const { name, description, settings, entries } = normalizeWorldbookData(req.body);

    const wb = await worldbookService.createWorldbook(req.user.userId, {
      name,
      description,
      settings,
      entries,
    });

    logger.info('世界书导入', { worldbookId: wb.id, userId: req.user.userId, entryCount: entries.length });

    res.status(201).json({ success: true, data: wb });
  }),
);

/**
 * PUT /api/worldbooks/:id
 * 更新世界书基本信息
 */
router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const owned = await worldbookService.checkOwnership(id, req.user.userId);
    if (!owned) throw ApiError.forbidden('无权访问该资源');

    const { name, description, settings } = req.body;
    const updated = await worldbookService.update(id, req.user.userId, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(settings !== undefined ? { settings } : {}),
    });

    logger.info('世界书更新', { worldbookId: id, userId: req.user.userId });

    res.json({ success: true, data: updated });
  }),
);

/**
 * DELETE /api/worldbooks/:id
 * 删除世界书
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const owned = await worldbookService.checkOwnership(id, req.user.userId);
    if (!owned) throw ApiError.forbidden('无权访问该资源');

    await worldbookService.delete(id, req.user.userId);

    logger.info('世界书删除', { worldbookId: id, userId: req.user.userId });

    res.json({ success: true, data: { message: '世界书已删除' } });
  }),
);

/**
 * POST /api/worldbooks/:id/entries
 * 添加世界书条目
 */
router.post(
  '/:id/entries',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const owned = await worldbookService.checkOwnership(id, req.user.userId);
    if (!owned) throw ApiError.forbidden('无权访问该资源');

    const entry = await worldbookService.addEntry(
      req.user.userId,
      id,
      req.body as Partial<WorldbookEntry>,
    );

    logger.info('世界书条目添加', { worldbookId: id, entryUid: entry.uid });

    res.status(201).json({ success: true, data: entry });
  }),
);

/**
 * PUT /api/worldbooks/:id/entries/:entryUid
 * 更新世界书条目
 */
router.put(
  '/:id/entries/:entryUid',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id, entryUid } = req.params;

    const owned = await worldbookService.checkOwnership(id, req.user.userId);
    if (!owned) throw ApiError.forbidden('无权访问该资源');

    const updated = await worldbookService.updateEntry(
      req.user.userId,
      id,
      entryUid,
      req.body as Partial<WorldbookEntry>,
    );

    res.json({ success: true, data: updated });
  }),
);

/**
 * DELETE /api/worldbooks/:id/entries/:entryUid
 * 删除世界书条目
 */
router.delete(
  '/:id/entries/:entryUid',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id, entryUid } = req.params;

    const owned = await worldbookService.checkOwnership(id, req.user.userId);
    if (!owned) throw ApiError.forbidden('无权访问该资源');

    const ok = await worldbookService.deleteEntry(req.user.userId, id, entryUid);
    if (!ok) throw ApiError.notFound('条目不存在');

    res.json({ success: true, data: { message: '条目已删除' } });
  }),
);

export default router;
