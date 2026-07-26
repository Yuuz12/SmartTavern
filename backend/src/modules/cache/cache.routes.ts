import { Router, type Request, type Response } from 'express';
import { conversationService } from '../../storage/index.js';
import { asyncHandler, ApiError, authRequired } from '../../middleware/index.js';
import {
  aggregateConversation,
  aggregateGlobal,
  aggregateHeatmap,
} from './cache.service.js';

const router = Router();

// 所有缓存路由都需要登录
router.use(authRequired);

/**
 * GET /api/cache/overview?days=90
 * 一次扫描返回全局缓存统计 + 聊天热力图
 */
router.get(
  '/overview',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const days = Math.max(1, Math.min(120, parseInt(req.query.days as string, 10) || 90));

    const convs = await conversationService.getAllFullByUserId(req.user.userId);
    const global = aggregateGlobal(convs);
    const heatmap = aggregateHeatmap(convs, days);

    res.json({ success: true, data: { global, heatmap } });
  }),
);

/**
 * GET /api/cache/conversation/:id
 * 获取单个对话的缓存统计与每条消息的缓存明细
 */
router.get(
  '/conversation/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const stats = aggregateConversation(conv);
    res.json({ success: true, data: stats });
  }),
);

export default router;
