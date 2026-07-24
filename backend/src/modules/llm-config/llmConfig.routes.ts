import { Router, type Request, type Response } from 'express';
import { userService } from '../../storage/index.js';
import { llmService } from '../llm/index.js';
import { authRequired, asyncHandler, ApiError } from '../../middleware/index.js';
import {
  encryptApiKey,
  decryptApiKey,
  logger,
  type LLMConfig,
} from '../../shared/index.js';

const router = Router();

// 所有 LLM 配置路由都需要登录
router.use(authRequired);

/**
 * 将加密的 apiKey 转换为掩码形式（前 6 位 + ***）
 */
function maskApiKey(encryptedKey: string): string {
  const decrypted = decryptApiKey(encryptedKey);
  if (!decrypted) return '';
  if (decrypted.length <= 6) return '***';
  return `${decrypted.slice(0, 6)}***`;
}

/**
 * 返回配置时对 apiKey 进行掩码处理
 */
function maskConfig(config: LLMConfig): LLMConfig {
  return {
    ...config,
    apiKey: maskApiKey(config.apiKey),
  };
}

/**
 * GET /api/llm-configs
 * 获取当前用户的 LLM 配置列表
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const configs = await userService.getLLMConfigs(req.user.userId);
    res.json({ success: true, data: configs.map(maskConfig) });
  }),
);

/**
 * POST /api/llm-configs
 * 创建 LLM 配置
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { name, provider, apiKey, baseUrl, model, isDefault, extraParams } = req.body;

    if (!name) throw ApiError.badRequest('配置名称不能为空');
    if (!provider) throw ApiError.badRequest('提供商不能为空');
    if (!model) throw ApiError.badRequest('模型不能为空');
    if (!apiKey) throw ApiError.badRequest('API Key 不能为空');

    const created = await userService.createLLMConfig(req.user.userId, {
      name,
      provider,
      apiKey: encryptApiKey(apiKey),
      baseUrl,
      model,
      isDefault,
      extraParams,
    });

    logger.info('LLM 配置创建', { configId: created.id, userId: req.user.userId, provider });

    res.status(201).json({ success: true, data: maskConfig(created) });
  }),
);

/**
 * PUT /api/llm-configs/:id
 * 更新 LLM 配置
 * 如果 body 含 apiKey 则重新加密，否则保留原值
 */
router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const configs = await userService.getLLMConfigs(req.user.userId);
    const existing = configs.find((c) => c.id === id);
    if (!existing) throw ApiError.notFound('LLM 配置不存在');

    const { name, provider, apiKey, baseUrl, model, isDefault, extraParams } = req.body;

    const updateData: Partial<LLMConfig> = {};
    if (name !== undefined) updateData.name = name;
    if (provider !== undefined) updateData.provider = provider;
    if (baseUrl !== undefined) updateData.baseUrl = baseUrl;
    if (model !== undefined) updateData.model = model;
    if (isDefault !== undefined) updateData.isDefault = isDefault;
    if (extraParams !== undefined) updateData.extraParams = extraParams;

    // 如果提供了新的 apiKey，则重新加密；否则保留原值
    if (typeof apiKey === 'string' && apiKey) {
      updateData.apiKey = encryptApiKey(apiKey);
    }

    const updated = await userService.updateLLMConfig(req.user.userId, id, updateData);

    logger.info('LLM 配置更新', { configId: id, userId: req.user.userId });

    res.json({ success: true, data: maskConfig(updated) });
  }),
);

/**
 * DELETE /api/llm-configs/:id
 * 删除 LLM 配置
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const configs = await userService.getLLMConfigs(req.user.userId);
    const existing = configs.find((c) => c.id === id);
    if (!existing) throw ApiError.notFound('LLM 配置不存在');

    const ok = await userService.deleteLLMConfig(req.user.userId, id);
    if (!ok) throw ApiError.notFound('LLM 配置不存在');

    logger.info('LLM 配置删除', { configId: id, userId: req.user.userId });

    res.json({ success: true, data: { message: '配置已删除' } });
  }),
);

/**
 * POST /api/llm-configs/:id/test
 * 测试 LLM 连接
 */
router.post(
  '/:id/test',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;

    const configs = await userService.getLLMConfigs(req.user.userId);
    const existing = configs.find((c) => c.id === id);
    if (!existing) throw ApiError.notFound('LLM 配置不存在');

    // 测试时需要解密 apiKey
    const testConfig: LLMConfig = {
      ...existing,
      apiKey: decryptApiKey(existing.apiKey),
    };

    const result = await llmService.testConnection(testConfig);

    logger.info('LLM 配置测试', {
      configId: id,
      userId: req.user.userId,
      success: result.success,
    });

    res.json({ success: true, data: result });
  }),
);

export default router;
