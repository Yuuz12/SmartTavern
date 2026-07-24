import { Router, type Request, type Response } from 'express';
import { systemConfig } from '../../storage/systemConfig.js';
import { asyncHandler, authRequired, adminRequired } from '../../middleware/index.js';

const router = Router();

/**
 * GET /api/system/registration
 * 公开接口：获取注册开关状态（供登录页判断是否显示注册标签）
 */
router.get(
  '/registration',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: { registrationEnabled: systemConfig.get().registrationEnabled },
    });
  }),
);

/**
 * GET /api/system/config
 * 管理员接口：获取完整系统配置
 */
router.get(
  '/config',
  authRequired,
  adminRequired,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: systemConfig.get() });
  }),
);

/**
 * PUT /api/system/config
 * 管理员接口：更新系统配置
 */
router.put(
  '/config',
  authRequired,
  adminRequired,
  asyncHandler(async (req: Request, res: Response) => {
    const { registrationEnabled } = req.body;
    const patch: { registrationEnabled?: boolean } = {};
    if (typeof registrationEnabled === 'boolean') {
      patch.registrationEnabled = registrationEnabled;
    }
    const updated = await systemConfig.update(patch);
    res.json({ success: true, data: updated });
  }),
);

export default router;
