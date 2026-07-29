import { Router, type Request, type Response } from 'express';
import { userService, characterService, worldbookService, conversationService } from '../../storage/index.js';
import { llmService } from '../llm/index.js';
import { asyncHandler, ApiError, authRequired } from '../../middleware/index.js';
import { ERROR_CODES, logger, applyRegexScripts, generateShortId, type LLMConfig, type Conversation, type Message, type MessageRole, type ConversationPrompt, type MemorySettings, type MemorySummary } from '../../shared/index.js';
import {
  DEFAULT_MEMORY_SETTINGS,
  getMemorySettings,
  getMemorySummaries,
  buildSummaryInjection,
  shouldGenerateSummary,
  generateSummaries,
  triggerSummaryGeneration,
} from './memory.service.js';
import { computeCacheHit, estimatePromptTokens, getCacheStats } from '../cache/cache.service.js';

const router = Router();

// 所有对话路由都需要登录
router.use(authRequired);

/**
 * GET /api/conversations
 * 获取当前用户的对话列表
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const search = req.query.search as string | undefined;
    const characterId = req.query.characterId as string | undefined;
    const list = await conversationService.getByUserId(req.user.userId, search, characterId);
    res.json({ success: true, data: list });
  }),
);

// ============ 对话导入导出（SillyTavern 兼容） ============

/** ISO 时间 -> SillyTavern send_date（人类可读英文） */
function toSillyTavernSendDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return new Date().toLocaleString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }
}

/** ISO 时间 -> SillyTavern create_date（YYYY-MM-DD@HHhMMmSSs） */
function toSillyTavernCreateDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}@${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}s`;
}

/** SillyTavern 日期（多种格式）-> ISO */
function parseSillyTavernDate(s: string): string {
  if (!s) return new Date().toISOString();
  const ts = Number(s);
  if (!isNaN(ts) && s.length >= 10) return new Date(ts).toISOString();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  return new Date().toISOString();
}

/** SmartTavern 消息 -> SillyTavern 消息对象 */
function buildSillyTavernMessage(msg: Message, characterName: string): Record<string, unknown> {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const extra: Record<string, unknown> = {};
  if (msg.metadata?.model) extra.model = msg.metadata.model;
  if (msg.metadata?.thinking) extra.reasoning = msg.metadata.thinking;
  if (msg.metadata?.tokens != null) extra.token_count = msg.metadata.tokens;

  const entry: Record<string, unknown> = {
    name: isUser ? 'User' : characterName,
    is_user: isUser,
    is_system: isSystem,
    send_date: toSillyTavernSendDate(msg.timestamp),
    mes: msg.content,
    extra,
  };

  if (msg.swipes && msg.swipes.length > 0) {
    entry.swipes = msg.swipes;
    entry.swipe_id = msg.swipeIndex ?? 0;
    if (msg.swipeThinkings && msg.swipeThinkings.length > 0) {
      entry.swipe_info = msg.swipes.map((_, i) => ({
        send_date: entry.send_date,
        extra: {
          model: msg.metadata?.model,
          reasoning: msg.swipeThinkings?.[i] || '',
        },
      }));
    }
  }
  return entry;
}

/** SmartTavern 对话 -> SillyTavern JSONL 字符串（首行头部，后续每行一条消息） */
function exportToSillyTavernJsonl(conv: Conversation, characterName: string): string {
  const header = {
    user_name: 'User',
    character_name: characterName,
    create_date: toSillyTavernCreateDate(conv.createdAt),
    chat_metadata: {},
  };
  const lines = [JSON.stringify(header)];
  for (const msg of conv.messages) {
    lines.push(JSON.stringify(buildSillyTavernMessage(msg, characterName)));
  }
  return lines.join('\n');
}

/** SmartTavern 对话 -> 纯文本 */
function exportToText(conv: Conversation, characterName: string): string {
  const lines: string[] = [];
  for (const msg of conv.messages) {
    const speaker = msg.role === 'user' ? 'User' : characterName;
    lines.push(`${speaker}:`);
    lines.push(msg.content);
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

/** 解析 SillyTavern 输入（支持 JSON 对象、JSON 数组、JSONL 字符串） */
function parseSillyTavernInput(raw: unknown): { characterName?: string; chat: Record<string, unknown>[] } {
  // 字符串：可能是单个 JSON 或 JSONL
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { chat: [] };
    // 先尝试作为单个 JSON 解析
    try {
      return parseSillyTavernInput(JSON.parse(trimmed));
    } catch {
      // JSONL：逐行解析，首行是头部（含 chat_metadata/character_name），后续行是消息
      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
      let characterName: string | undefined;
      const chat: Record<string, unknown>[] = [];
      for (let i = 0; i < lines.length; i++) {
        let obj: unknown;
        try {
          obj = JSON.parse(lines[i]);
        } catch {
          continue; // 忽略解析失败的行
        }
        if (i === 0 && obj && typeof obj === 'object' && !Array.isArray(obj)
          && ('chat_metadata' in obj || 'user_name' in obj || 'character_name' in obj || 'create_date' in obj)) {
          // 头部行：提取角色名
          characterName = (obj as Record<string, unknown>).character_name as string | undefined;
        } else if (obj && typeof obj === 'object') {
          chat.push(obj as Record<string, unknown>);
        }
      }
      return { characterName, chat };
    }
  }
  // 数组：纯消息数组
  if (Array.isArray(raw)) {
    return { chat: raw as Record<string, unknown>[] };
  }
  // 对象：带 chat 数组
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const chat = Array.isArray(obj.chat) ? (obj.chat as Record<string, unknown>[]) : [];
    return { characterName: obj.character_name as string | undefined, chat };
  }
  return { chat: [] };
}

/** SillyTavern 消息数组 -> SmartTavern 消息数组 */
function convertSillyTavernMessages(chat: Record<string, unknown>[]): Message[] {
  return chat.map((entry) => {
    const role: MessageRole = entry.is_system ? 'system' : (entry.is_user ? 'user' : 'assistant');
    const msg: Message = {
      id: generateShortId(),
      role,
      content: (entry.mes as string) ?? '',
      timestamp: parseSillyTavernDate((entry.send_date as string) || ''),
    };
    const extra = (entry.extra as Record<string, unknown>) || {};
    const metadata: Record<string, unknown> = {};
    if (extra.model) metadata.model = extra.model;
    if (extra.reasoning) metadata.thinking = extra.reasoning;
    if (extra.token_count != null) metadata.tokens = extra.token_count;
    if (Object.keys(metadata).length) msg.metadata = metadata as Message['metadata'];
    const swipes = entry.swipes as string[] | undefined;
    if (Array.isArray(swipes) && swipes.length > 0) {
      msg.swipes = swipes;
      msg.swipeIndex = (entry.swipe_id as number) ?? 0;
      msg.content = swipes[msg.swipeIndex] ?? ((entry.mes as string) ?? '');
      const swipeInfo = entry.swipe_info as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(swipeInfo)) {
        msg.swipeThinkings = swipeInfo.map((si) => {
          const siExtra = (si?.extra as Record<string, unknown>) || {};
          return (siExtra.reasoning as string) || '';
        });
      }
    }
    return msg;
  });
}

/**
 * GET /api/conversations/:id/export
 * 导出对话（SillyTavern 兼容 JSON 或纯文本）
 */
router.get(
  '/:id/export',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');
    const character = await characterService.get(conv.characterId, req.user.userId);
    const characterName = character?.name || 'Character';
    const format = (req.query.format as string) || 'json';
    const safeTitle = encodeURIComponent(conv.title || 'conversation');

    if (format === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.txt"`);
      res.send(exportToText(conv, characterName));
      return;
    }

    res.setHeader('Content-Type', 'application/x-jsonlines; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.jsonl"`);
    res.send(exportToSillyTavernJsonl(conv, characterName));
  }),
);

/**
 * POST /api/conversations/import
 * 导入对话（SillyTavern 兼容 JSON）
 */
router.post(
  '/import',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { characterId, llmConfigId, data, title: customTitle } = req.body as {
      characterId?: string;
      llmConfigId?: string;
      data: unknown;
      title?: string;
    };
    if (!characterId) throw ApiError.badRequest('角色卡 ID 不能为空');
    if (!data) throw ApiError.badRequest('导入数据不能为空');

    const character = await characterService.get(characterId, req.user.userId);
    if (!character) throw ApiError.notFound('角色卡不存在');

    // LLM 配置：传入的或用户的第一个
    const llmConfigs = await userService.getLLMConfigs(req.user.userId);
    let configId = llmConfigId;
    if (configId) {
      if (!llmConfigs.find((c) => c.id === configId)) {
        throw ApiError.notFound('LLM 配置不存在', ERROR_CODES.LLM_CONFIG_NOT_FOUND);
      }
    } else {
      if (llmConfigs.length === 0) throw ApiError.badRequest('未找到可用的 LLM 配置');
      configId = llmConfigs[0].id;
    }

    const { characterName: importedName, chat } = parseSillyTavernInput(data);
    const messages = convertSillyTavernMessages(chat);

    const characterName = importedName || character.name;
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const title = customTitle || `${characterName} - ${timeStr}`;

    const conv = await conversationService.createConversation({
      userId: req.user.userId,
      characterId,
      llmConfigId: configId,
      title,
      systemPrompt: character.systemPrompt,
      initialMessages: messages,
    });

    res.json({ success: true, data: { id: conv.id, title: conv.title } });
  }),
);

/**
 * GET /api/conversations/:id
 * 获取对话详情
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');
    res.json({ success: true, data: conv });
  }),
);

/**
 * POST /api/conversations
 * 创建对话
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { characterId, llmConfigId, title, systemPrompt, worldBookIds, settings, autoSendFirstMessage, greetingIndex } = req.body;

    if (!characterId) throw ApiError.badRequest('角色卡 ID 不能为空');
    if (!llmConfigId) throw ApiError.badRequest('LLM 配置 ID 不能为空');

    // 校验角色卡归属
    const character = await characterService.get(characterId, req.user.userId);
    if (!character) {
      throw ApiError.notFound('角色卡不存在');
    }

    // 校验 LLM 配置归属
    const llmConfigs = await userService.getLLMConfigs(req.user.userId);
    const llmConfig = llmConfigs.find((c) => c.id === llmConfigId);
    if (!llmConfig) throw ApiError.notFound('LLM 配置不存在', ERROR_CODES.LLM_CONFIG_NOT_FOUND);

    // 校验世界书归属
    if (worldBookIds && Array.isArray(worldBookIds)) {
      for (const wbId of worldBookIds) {
        const wb = await worldbookService.get(wbId, req.user.userId);
        if (!wb) {
          throw ApiError.notFound(`世界书不存在: ${wbId}`);
        }
      }
    }

    // 构建初始消息：支持选择开场白（greetingIndex=0 用 firstMes，>0 用 alternateGreetings[index-1]）
    const initialMessages: Message[] = [];
    let greetingContent: string | undefined;
    if (greetingIndex != null && greetingIndex > 0) {
      // 使用备选开场白
      const altGreetings = character.alternateGreetings || [];
      greetingContent = altGreetings[greetingIndex - 1];
    } else {
      // 默认使用 firstMes
      greetingContent = character.firstMes;
    }
    if (greetingContent) {
      initialMessages.push({
        id: Math.random().toString(36).slice(2),
        role: 'assistant',
        content: greetingContent,
        timestamp: new Date().toISOString(),
      });
    }

    // 默认标题：角色名 - 创建时间（YYYY-MM-DD HH:mm）
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const defaultTitle = `${character.name} - ${timeStr}`;

    const conv = await conversationService.createConversation({
      userId: req.user.userId,
      characterId,
      llmConfigId,
      title: title || defaultTitle,
      systemPrompt: systemPrompt || character.systemPrompt,
      worldBookIds,
      settings,
      initialMessages,
    });

    logger.info('对话创建', { conversationId: conv.id, userId: req.user.userId, characterId });

    res.status(201).json({ success: true, data: conv });
  }),
);

/**
 * PUT /api/conversations/:id
 * 更新对话信息
 */
router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const { title, systemPrompt, worldBookIds, settings, llmConfigId } = req.body;
    const updated = await conversationService.update(req.params.id, req.user.userId, {
      ...(title !== undefined ? { title } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(worldBookIds !== undefined ? { worldBookIds } : {}),
      ...(settings !== undefined ? { settings } : {}),
      ...(llmConfigId !== undefined ? { llmConfigId } : {}),
    });
    res.json({ success: true, data: updated });
  }),
);

/**
 * DELETE /api/conversations/:id
 * 删除对话
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    await conversationService.delete(req.params.id, req.user.userId);
    res.json({ success: true, data: { message: '对话已删除' } });
  }),
);

/**
 * DELETE /api/conversations/:id/messages/:msgId
 * 删除消息
 */
router.delete(
  '/:id/messages/:msgId',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const ok = await conversationService.deleteMessage(req.params.id, req.user.userId, req.params.msgId);
    if (!ok) throw ApiError.notFound('消息不存在');
    res.json({ success: true, data: { message: '消息已删除' } });
  }),
);

/**
 * PUT /api/conversations/:id/messages/:msgId
 * 编辑消息内容
 */
router.put(
  '/:id/messages/:msgId',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const { content } = req.body;
    if (typeof content !== 'string') throw ApiError.badRequest('content 必须为字符串');

    const updated = await conversationService.updateMessage(req.params.id, req.user.userId, req.params.msgId, { content });
    if (!updated) throw ApiError.notFound('消息不存在');
    res.json({ success: true, data: updated });
  }),
);

/**
 * POST /api/conversations/:id/regenerate
 * 重新生成最后一条 AI 回复
 * 使用 SSE 流式返回
 */
router.post(
  '/:id/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    // 移除最后一条 AI 消息
    await conversationService.removeLastAssistantMessage(req.params.id, req.user.userId);

    // 重新获取对话（消息已更新）
    const updatedConv = await conversationService.get(req.params.id, req.user.userId);
    if (!updatedConv) throw ApiError.notFound('对话不存在');

    // 获取 LLM 配置
    const llmConfigs = await userService.getLLMConfigs(req.user.userId);
    const llmConfig = llmConfigs.find((c) => c.id === updatedConv.llmConfigId);
    if (!llmConfig) throw ApiError.notFound('LLM 配置不存在', ERROR_CODES.LLM_CONFIG_NOT_FOUND);

    // 流式生成
    await streamLLMResponse(req, res, updatedConv, llmConfig);
  }),
);

/**
 * POST /api/conversations/:id/swipe
 * 重新生成最后一条 AI 回复（保留旧回复，新增 swipe）
 * 使用 SSE 流式返回
 */
router.post(
  '/:id/swipe',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    // 找到最后一条 assistant 消息
    const messages = conv.messages || [];
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistantMsg) throw ApiError.badRequest('没有 AI 回复可以重新生成');

    // 获取 LLM 配置
    const llmConfigs = await userService.getLLMConfigs(req.user.userId);
    const llmConfig = llmConfigs.find((c) => c.id === conv.llmConfigId);
    if (!llmConfig) throw ApiError.notFound('LLM 配置不存在', ERROR_CODES.LLM_CONFIG_NOT_FOUND);

    // 流式生成（swipe 模式：不创建新消息，更新现有消息的 swipes 数组）
    await streamLLMResponse(req, res, conv, llmConfig, undefined, lastAssistantMsg.id);
  }),
);

/**
 * PUT /api/conversations/:id/messages/:msgId/swipe
 * 切换消息的 swipe 索引
 */
router.put(
  '/:id/messages/:msgId/swipe',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const { swipeIndex } = req.body;
    if (typeof swipeIndex !== 'number') throw ApiError.badRequest('swipeIndex 必须为数字');

    const msg = conv.messages.find((m) => m.id === req.params.msgId);
    if (!msg) throw ApiError.notFound('消息不存在');
    if (!msg.swipes || swipeIndex < 0 || swipeIndex >= msg.swipes.length) {
      throw ApiError.badRequest('swipeIndex 超出范围');
    }

    const updated = await conversationService.updateMessage(req.params.id, req.user.userId, req.params.msgId, {
      swipeIndex,
      content: msg.swipes[swipeIndex],
    });
    res.json({ success: true, data: updated });
  }),
);

/**
 * POST /api/conversations/:id/continue
 * 在最后一条 AI 消息基础上继续生成（续写）
 * 使用 SSE 流式返回
 */
router.post(
  '/:id/continue',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    // 获取最后一条 AI 消息
    const messages = conv.messages || [];
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistantMsg) {
      throw ApiError.badRequest('没有 AI 回复可以续写');
    }

    // 获取 LLM 配置
    const llmConfigs = await userService.getLLMConfigs(req.user.userId);
    const llmConfig = llmConfigs.find((c) => c.id === conv.llmConfigId);
    if (!llmConfig) throw ApiError.notFound('LLM 配置不存在', ERROR_CODES.LLM_CONFIG_NOT_FOUND);

    // 流式生成（续写模式）
    await streamLLMResponse(req, res, conv, llmConfig, lastAssistantMsg.id);
  }),
);

/**
 * POST /api/conversations/:id/ai-help
 * AI 帮答：基于智能体（角色）的最新回复，流式生成可推进剧情的用户回复建议
 * 仅返回建议文本，不保存为消息。使用 SSE 流式返回。
 */
router.post(
  '/:id/ai-help',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    // 获取最后一条 AI 回复（智能体的回答）
    const messages = conv.messages || [];
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistantMsg) {
      throw ApiError.badRequest('没有 AI 回复可作为帮答依据');
    }

    // 获取 LLM 配置
    const llmConfigs = await userService.getLLMConfigs(req.user.userId);
    const llmConfig = llmConfigs.find((c) => c.id === conv.llmConfigId);
    if (!llmConfig) throw ApiError.notFound('LLM 配置不存在', ERROR_CODES.LLM_CONFIG_NOT_FOUND);

    await streamAiHelpReply(req, res, conv, llmConfig);
  }),
);

/**
 * POST /api/conversations/:id/messages
 * 发送消息并获取 AI 回复（流式）
 * 使用 Server-Sent Events (SSE)
 */
router.post(
  '/:id/messages',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      throw ApiError.badRequest('消息内容不能为空');
    }

    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    // 保存用户消息
    await conversationService.addMessage(req.params.id, req.user.userId, { role: 'user', content });

    // 获取 LLM 配置
    const llmConfigs = await userService.getLLMConfigs(req.user.userId);
    const llmConfig = llmConfigs.find((c) => c.id === conv.llmConfigId);
    if (!llmConfig) throw ApiError.notFound('LLM 配置不存在', ERROR_CODES.LLM_CONFIG_NOT_FOUND);

    // 重新获取对话（包含刚保存的用户消息）
    const updatedConv = await conversationService.get(req.params.id, req.user.userId);
    if (!updatedConv) throw ApiError.notFound('对话不存在');

    // 流式生成
    await streamLLMResponse(req, res, updatedConv, llmConfig);
  }),
);

/**
 * 流式生成 LLM 响应并通过 SSE 返回
 * @param continueFromMessageId 续写模式：从此消息 ID 继续生成
 */
async function streamLLMResponse(
  req: Request,
  res: Response,
  conv: NonNullable<Awaited<ReturnType<typeof conversationService.get>>>,
  llmConfig: LLMConfig,
  continueFromMessageId?: string,
  swipeMessageId?: string,
): Promise<void> {
  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // 主动 flush 辅助函数（确保数据立即发送到客户端）
  const writeSSE = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    // 兼容 Express 的 res.flush（部分环境需要主动刷新）
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  // 构建系统提示词、消息列表等（SSE 已建立，错误需通过 SSE 发送）
  let messages: { role: MessageRole; content: string }[];
  let messagesForCache: { role: MessageRole; content: string }[];
  let finalSystemPrompt: string;
  let memory: ReturnType<typeof getMemorySettings>;
  let aiMessage: { id: string };
  let originalContent = '';

  try {
    // 构建系统提示词（包含角色卡信息 + 世界书 + Prompt Manager 的 relative prompts）
    const character = await characterService.get(conv.characterId, conv.userId);
    const { systemPrompt: baseSystemPrompt, inChatPrompts } = character
      ? await buildSystemPrompt(conv, character)
      : { systemPrompt: conv.systemPrompt || '', inChatPrompts: [] };

    // 读取记忆设置和总结
    memory = getMemorySettings(conv);
    const summaries = getMemorySummaries(conv);

    // 构建消息列表（过滤掉系统消息，因为已通过 systemPrompt 传递）
    messages = conv.messages
      .filter((m) => m.role !== 'system')
      .filter((m) => !swipeMessageId || m.id !== swipeMessageId) // swipe 模式：排除目标消息
      .map((m) => ({ role: m.role, content: m.content }));

    // 记忆功能：截断旧消息，只保留最近 maxContextFloors 条
    if (memory?.enabled && memory.maxContextFloors > 0 && messages.length > memory.maxContextFloors) {
      messages = messages.slice(-memory.maxContextFloors);
    }

    // 保存不含注入内容的 messages 副本，供缓存命中判定使用
    // in-chat 提示词按 injection_depth 注入，位置随消息数变化，若参与指纹比对会导致前缀每次都断裂
    // 续写指令同理。缓存命中应只反映对话历史本身的连续性
    messagesForCache = messages.map((m) => ({ role: m.role, content: m.content }));

    // 记忆功能：将最近 N 条总结注入 systemPrompt
    finalSystemPrompt = baseSystemPrompt;
    if (memory?.enabled && summaries.length > 0) {
      const summaryBlock = buildSummaryInjection(summaries, memory);
      if (summaryBlock) {
        finalSystemPrompt = finalSystemPrompt + '\n\n' + summaryBlock;
      }
    }

    // 续写模式：保留完整对话历史（含最后一条 assistant），追加续写指令让 LLM 自然接续
    if (continueFromMessageId) {
      const originalMsg = conv.messages.find(m => m.id === continueFromMessageId);
      originalContent = originalMsg?.content || '';
      // 保留 assistant 消息在历史中，追加一条 user 指令
      messages.push({ role: 'user', content: '[System note: Continue the previous assistant response. Pick up exactly where it left off. Do NOT repeat or rephrase any existing text. Write only the continuation.]' });
    }

    // 注入 in-chat 提示词（按 injection_depth 决定位置，0 = 最新消息之前）
    if (inChatPrompts.length > 0) {
      // 按 depth 分组，相同 depth 的按 injection_order 排序
      const byDepth = new Map<number, ConversationPrompt[]>();
      for (const p of inChatPrompts) {
        const arr = byDepth.get(p.injection_depth) || [];
        arr.push(p);
        byDepth.set(p.injection_depth, arr);
      }
      // 从大 depth 到小 depth 插入（避免索引偏移）
      const depths = Array.from(byDepth.keys()).sort((a, b) => b - a);
      for (const depth of depths) {
        const group = byDepth.get(depth)!.sort((a, b) => a.injection_order - b.injection_order);
        const insertIdx = Math.max(0, messages.length - depth);
        for (const p of group) {
          messages.splice(insertIdx, 0, { role: p.role, content: p.content });
        }
      }
    }

    // 创建 AI 消息占位（续写/swipe 模式：更新现有消息；普通模式：创建新消息）
    if (continueFromMessageId) {
      aiMessage = { id: continueFromMessageId };
    } else if (swipeMessageId) {
      aiMessage = { id: swipeMessageId };
    } else {
      aiMessage = await conversationService.addMessage(req.params.id, conv.userId, {
        role: 'assistant',
        content: '',
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    logger.error('LLM 准备阶段失败', { conversationId: req.params.id, error: message });
    writeSSE({ type: 'error', message });
    res.end();
    return;
  }

  // 发送消息 ID 给客户端
  writeSSE({ type: 'message_id', messageId: aiMessage.id });

  let fullContent = '';  // 续写模式：仅累积新生成的内容，最终保存时拼接原文
  let fullThinking = '';
  const startTime = Date.now();

  // 创建 AbortController（支持客户端取消）
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  // 正则脚本：对发送给 LLM 的提示词应用 affects.prompt 的正则替换（用户正则 + 预设正则 + 角色卡内嵌正则）
  const userData = await userService.get(conv.userId);
  const userRegex = userData?.regexScripts || [];
  const presetRegex = (req.body?.presetRegexScripts as import('../../shared/index.js').RegexScript[]) || [];
  const characterRegex = (req.body?.characterRegexScripts as import('../../shared/index.js').RegexScript[]) || [];
  const regexScripts = [...userRegex, ...presetRegex, ...characterRegex];
  if (regexScripts.length > 0) {
    const totalMsgs = messages.length;
    messages = messages.map((m, idx) => {
      const depth = totalMsgs - 1 - idx; // 0=最后一条
      const result = applyRegexScripts(m.content, regexScripts, {
        target: 'prompt',
        depth,
        characterId: conv.characterId,
      });
      return result !== m.content ? { ...m, content: result } : m;
    });
  }

  // 缓存命中判定：对对话历史消息（不含动态注入的 in-chat 提示词/续写指令）计算指纹
  // 与上一次请求比对，得出 cachedTokens / hit。指纹复用前缀 token 数以避免重复 encode。
  const cacheAnalysis = computeCacheHit(getCacheStats(conv)?.lastContext, messagesForCache, finalSystemPrompt);

  try {
    const stream = llmService.chat(messages, llmConfig, {
      systemPrompt: finalSystemPrompt,
      temperature: conv.settings.temperature as number | undefined,
      maxTokens: conv.settings.maxTokens as number | undefined,
      signal: controller.signal,
    });

    let usageTokens = 0;
    let usagePromptTokens = 0;
    for await (const chunk of stream) {
      if (chunk.type === 'thinking') {
        fullThinking += chunk.content;
        writeSSE({ type: 'thinking', content: chunk.content });
      } else if (chunk.type === 'usage') {
        usageTokens = chunk.completionTokens || chunk.totalTokens || 0;
        usagePromptTokens = chunk.promptTokens || 0;
      } else {
        fullContent += chunk.content;
        writeSSE({ type: 'chunk', content: chunk.content });
      }
    }

    // 续写模式：拼接原文 + 后缀 + 新生成内容
    const suffixMap: Record<string, string> = { none: '', space: ' ', newline: '\n', double_newline: '\n\n' };
    const continueSuffix = continueFromMessageId ? (suffixMap[(req.body?.continueSuffix as string) || 'newline'] ?? '\n') : '';
    const finalContent = originalContent + continueSuffix + fullContent;

    // token 计数：优先用 API 返回的真实值，否则用 gpt-tokenizer 估算
    const outputTokens = usageTokens > 0 ? usageTokens : (await import('gpt-tokenizer')).encode(finalContent).length;
    // 输入 token：优先用 API 返回的 promptTokens，否则用 gpt-tokenizer 估算（systemPrompt + 全部消息）
    // 注意：不同 provider 的 promptTokens 语义不同（OpenAI 含缓存、Anthropic 不含），
    // 此处仅作辅助展示，命中率计算统一用 cachedTokens / inputTokens（clamp 0-1）
    const promptTokens = usagePromptTokens > 0 ? usagePromptTokens : estimatePromptTokens(finalSystemPrompt, messages);
    if (swipeMessageId) {
      // swipe 模式：将新内容追加到 swipes 数组，思维链追加到 swipeThinkings
      const swipeMsg = conv.messages.find((m) => m.id === swipeMessageId);
      const oldSwipes = swipeMsg?.swipes || [swipeMsg?.content || ''];
      const newSwipes = [...oldSwipes, finalContent];
      const oldThinkings: string[] = swipeMsg?.swipeThinkings || [(swipeMsg?.metadata?.thinking as string) || ''];
      const newThinkings = [...oldThinkings, fullThinking || ''];
      await conversationService.updateMessage(req.params.id, conv.userId, aiMessage.id, {
        content: finalContent,
        swipes: newSwipes,
        swipeThinkings: newThinkings,
        swipeIndex: newSwipes.length - 1,
        metadata: {
          duration: Date.now() - startTime,
          tokens: outputTokens,
          model: llmConfig.model,
          promptTokens,
          completionTokens: outputTokens,
          cachedTokens: cacheAnalysis.cachedTokens,
          cacheHit: cacheAnalysis.hit,
          ...(fullThinking ? { thinking: fullThinking } : {}),
        },
      });
    } else {
      await conversationService.updateMessage(req.params.id, conv.userId, aiMessage.id, {
        content: finalContent,
        metadata: {
          duration: Date.now() - startTime,
          tokens: outputTokens,
          model: llmConfig.model,
          promptTokens,
          completionTokens: outputTokens,
          cachedTokens: cacheAnalysis.cachedTokens,
          cacheHit: cacheAnalysis.hit,
          ...(fullThinking ? { thinking: fullThinking } : {}),
        },
      });
    }

    // 更新缓存状态机：保存本次请求的指纹供下一次命中判定（仅在成功路径更新）
    try {
      const latestConv = await conversationService.get(req.params.id, conv.userId);
      if (latestConv) {
        await conversationService.update(req.params.id, conv.userId, {
          settings: { ...latestConv.settings, cacheStats: { lastContext: cacheAnalysis.fingerprint } },
        });
      }
    } catch (err) {
      logger.error('更新缓存状态失败', {
        conversationId: req.params.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 发送完成事件
    writeSSE({
      type: 'done',
      content: finalContent,
      ...(fullThinking ? { thinking: fullThinking } : {}),
      duration: Date.now() - startTime,
      tokens: outputTokens,
    });

    logger.info('LLM 流式生成完成', {
      conversationId: req.params.id,
      messageId: aiMessage.id,
      duration: Date.now() - startTime,
      contentLength: fullContent.length,
      thinkingLength: fullThinking.length,
    });

    // 记忆功能：同步触发总结生成（通过 SSE 通知前端进度，期间禁止用户输入）
    if (memory?.enabled) {
      // 先通知前端开始总结，禁止输入
      writeSSE({ type: 'memory_generating' });

      try {
        await triggerSummaryGeneration(req.params.id, conv.userId, llmConfig);
      } catch (err) {
        logger.error('总结生成失败', {
          conversationId: req.params.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 通知前端总结完成，恢复输入
      writeSSE({ type: 'memory_done' });
    }

    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    logger.error('LLM 流式生成失败', { conversationId: req.params.id, error: message });

    if (swipeMessageId) {
      // swipe 模式：不删除已有消息，仅保存部分内容（如果有）
      if (fullContent || fullThinking) {
        const swipeMsg = conv.messages.find((m) => m.id === swipeMessageId);
        const oldSwipes = swipeMsg?.swipes || [swipeMsg?.content || ''];
        const newSwipes = [...oldSwipes, fullContent];
        const oldThinkings: string[] = swipeMsg?.swipeThinkings || [(swipeMsg?.metadata?.thinking as string) || ''];
        const newThinkings = [...oldThinkings, fullThinking || ''];
        await conversationService.updateMessage(req.params.id, conv.userId, aiMessage.id, {
          content: fullContent,
          swipes: newSwipes,
          swipeThinkings: newThinkings,
          swipeIndex: newSwipes.length - 1,
          metadata: {
            error: message,
            duration: Date.now() - startTime,
            ...(fullThinking ? { thinking: fullThinking } : {}),
          },
        });
      }
    } else if (fullContent || fullThinking) {
      // 保存部分内容（如果有）
      await conversationService.updateMessage(req.params.id, conv.userId, aiMessage.id, {
        content: fullContent,
        metadata: {
          error: message,
          duration: Date.now() - startTime,
          ...(fullThinking ? { thinking: fullThinking } : {}),
        },
      });
    } else {
      // 删除空消息（仅普通模式）
      await conversationService.deleteMessage(req.params.id, conv.userId, aiMessage.id);
    }

    writeSSE({ type: 'error', message });
    res.end();
  }
}

/**
 * 流式生成 AI 帮答回复（不保存消息）
 * 基于对话历史与角色（智能体）的最新回复，生成可推进剧情的用户回复建议
 */
async function streamAiHelpReply(
  req: Request,
  res: Response,
  conv: NonNullable<Awaited<ReturnType<typeof conversationService.get>>>,
  llmConfig: LLMConfig,
): Promise<void> {
  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // 构建对话上下文（过滤系统消息）
  const contextMessages = conv.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  // 帮答系统提示词：用户自定义或默认
  const customPrompt = (req.body?.aiHelpPrompt as string)?.trim();
  const helpSystemPrompt = customPrompt ||
    '你是一个角色扮演对话助手。以下是用户与角色（智能体）之间的对话历史。' +
    '请根据角色最新的回复，以用户的身份撰写一个自然、符合语境、能够推进剧情发展的回复。\n\n' +
    '要求：\n' +
    '- 只输出用户回复的内容本身，不要加引号、不要解释、不要添加角色名或任何前缀\n' +
    '- 回复要自然贴合对话语境与角色性格\n' +
    '- 长度适中，与既有对话风格一致';

  // 追加一条用户指令，引导 LLM 生成用户侧回复
  const messages = [
    ...contextMessages,
    {
      role: 'user' as const,
      content: '[系统指令] 请根据上述对话中角色的最新回复，以用户的身份撰写一个能推进剧情的自然回复，只输出回复内容本身。',
    },
  ];

  // 创建 AbortController（支持客户端取消）
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const writeSSE = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  try {
    const stream = llmService.chat(messages, llmConfig, {
      systemPrompt: helpSystemPrompt,
      temperature: conv.settings.temperature as number | undefined,
      maxTokens: conv.settings.maxTokens as number | undefined,
      signal: controller.signal,
    });

    let fullContent = '';
    for await (const chunk of stream) {
      // 帮答场景仅转发正文，忽略思维链和 usage
      if (chunk.type !== 'text') continue;
      fullContent += chunk.content;
      writeSSE({ type: 'chunk', content: chunk.content });
    }

    writeSSE({ type: 'done', content: fullContent });
    res.end();

    logger.info('AI 帮答生成完成', {
      conversationId: req.params.id,
      contentLength: fullContent.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    logger.error('AI 帮答生成失败', { conversationId: req.params.id, error: message });
    writeSSE({ type: 'error', message });
    res.end();
  }
}

// ============ 记忆功能路由 ============

/**
 * GET /api/conversations/:id/memory
 * 获取记忆设置和总结列表
 */
router.get(
  '/:id/memory',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const memory = getMemorySettings(conv);
    const summaries = getMemorySummaries(conv);

    res.json({
      success: true,
      data: {
        memory: memory || DEFAULT_MEMORY_SETTINGS,
        summaries,
        messageCount: conv.messages.length,
      },
    });
  }),
);

/**
 * PUT /api/conversations/:id/memory
 * 更新记忆设置（实时生效，无需保存按钮）
 */
router.put(
  '/:id/memory',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const { memory } = req.body as { memory: MemorySettings };
    const updatedSettings = { ...conv.settings, memory };
    const updated = await conversationService.update(req.params.id, req.user.userId, {
      settings: updatedSettings,
    });
    res.json({ success: true, data: { memory: updated.settings.memory } });
  }),
);

/**
 * POST /api/conversations/:id/memory/summaries
 * 手动触发总结生成
 */
router.post(
  '/:id/memory/summaries',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const memory = getMemorySettings(conv);
    if (!memory?.enabled) throw ApiError.badRequest('记忆功能未启用');

    const llmConfigs = await userService.getLLMConfigs(req.user.userId);
    const targetLlmId = memory.llmConfigId || conv.llmConfigId;
    const llmConfig = llmConfigs.find((c) => c.id === targetLlmId);
    if (!llmConfig) throw ApiError.notFound('LLM 配置不存在');

    // generateSummaries 返回完整的总结列表（含已有 + 新增/更新）
    const allSummaries = await generateSummaries(conv, llmConfig, memory);

    // 保存总结到对话
    const latestConv = await conversationService.get(req.params.id, req.user.userId);
    if (!latestConv) throw ApiError.notFound('对话不存在');

    await conversationService.update(req.params.id, req.user.userId, {
      settings: { ...latestConv.settings, memorySummaries: allSummaries },
    });

    res.json({ success: true, data: { summaries: allSummaries } });
  }),
);

/**
 * PUT /api/conversations/:id/memory/summaries/:summaryId
 * 编辑总结内容
 */
router.put(
  '/:id/memory/summaries/:summaryId',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const summaries = getMemorySummaries(conv);
    const idx = summaries.findIndex((s) => s.id === req.params.summaryId);
    if (idx < 0) throw ApiError.notFound('总结不存在');

    const { content } = req.body as { content: string };
    summaries[idx] = { ...summaries[idx], content, isEdited: true };
    await conversationService.update(req.params.id, req.user.userId, {
      settings: { ...conv.settings, memorySummaries: summaries },
    });
    res.json({ success: true, data: { summary: summaries[idx] } });
  }),
);

/**
 * DELETE /api/conversations/:id/memory/summaries/:summaryId
 * 删除总结
 */
router.delete(
  '/:id/memory/summaries/:summaryId',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const conv = await conversationService.get(req.params.id, req.user.userId);
    if (!conv) throw ApiError.notFound('对话不存在');

    const summaries = getMemorySummaries(conv);
    const filtered = summaries.filter((s) => s.id !== req.params.summaryId);
    await conversationService.update(req.params.id, req.user.userId, {
      settings: { ...conv.settings, memorySummaries: filtered },
    });
    res.json({ success: true, data: { message: '总结已删除' } });
  }),
);

/**
 * 构建系统提示词
 */
/**
 * 构建系统提示词 + 收集 in-chat 提示词
 * - relative prompts（injection_position=0）：按 injection_order 升序拼接进 systemPrompt
 * - in-chat prompts（injection_position=1）：返回给调用方，按 depth/order 插入聊天历史
 *
 * 宏替换：{{char}} {{user}} {{description}} {{personality}} {{scenario}} {{mesExamples}}
 * 对话侧目前没有 user 名字字段，{{user}} 暂用 "User"。
 */
async function buildSystemPrompt(
  conv: NonNullable<Awaited<ReturnType<typeof conversationService.get>>>,
  character: NonNullable<Awaited<ReturnType<typeof characterService.get>>>,
): Promise<{ systemPrompt: string; inChatPrompts: ConversationPrompt[] }> {
  if (!character) {
    return { systemPrompt: conv.systemPrompt || '', inChatPrompts: [] };
  }

  // 宏替换函数
  const macros: Record<string, string> = {
    '{{char}}': character.name || '',
    '{{user}}': 'User',
    '{{description}}': character.description || '',
    '{{personality}}': character.personality || '',
    '{{scenario}}': character.scenario || '',
    '{{mesExamples}}': character.mesExample || '',
  };
  const applyMacros = (text: string) => {
    let result = text;
    for (const [k, v] of Object.entries(macros)) {
      result = result.split(k).join(v);
    }
    return result;
  };

  // 收集世界书内容（constant + 关键词匹配）
  let worldInfoBefore = '';
  let worldInfoAfter = '';
  if (conv.worldBookIds.length > 0) {
    const beforeParts: string[] = [];
    const afterParts: string[] = [];
    // 用最近几条消息作为关键词扫描文本
    const recentText = conv.messages
      .slice(-4)
      .map((m) => m.content)
      .join('\n');
    for (const wbId of conv.worldBookIds) {
      const wb = await worldbookService.get(wbId, conv.userId);
      if (!wb) continue;
      for (const entry of wb.entries) {
        if (!entry.enabled) continue;
        if (entry.constant) {
          (entry.position === 'after' ? afterParts : beforeParts).push(entry.content);
          continue;
        }
        // 关键词匹配
        const haystack = entry.caseSensitive ? recentText : recentText.toLowerCase();
        const keys = entry.caseSensitive ? entry.keys : entry.keys.map((k) => k.toLowerCase());
        if (keys.some((k) => k && haystack.includes(k))) {
          (entry.position === 'after' ? afterParts : beforeParts).push(entry.content);
        }
      }
    }
    worldInfoBefore = beforeParts.join('\n\n');
    worldInfoAfter = afterParts.join('\n\n');
  }

  // Prompt Manager 中的提示词列表（默认空数组）
  const prompts: ConversationPrompt[] = Array.isArray(conv.settings.prompts)
    ? (conv.settings.prompts as ConversationPrompt[])
    : [];

  const relativePrompts = prompts
    .filter((p) => p.enabled && p.injection_position === 0)
    .sort((a, b) => a.injection_order - b.injection_order);

  // in-chat 提示词：过滤掉 chatHistory marker（聊天历史本身就是 messages 数组，无需占位符）
  // 以及空 content 的条目，避免向聊天历史插入空消息
  const inChatPrompts = prompts
    .filter((p) => p.enabled && p.injection_position === 1 && p.id !== 'chatHistory')
    .filter((p) => (p.content || '').trim() !== '')
    .sort((a, b) => a.injection_order - b.injection_order);

  // 对内置 marker 条目做特殊处理：内容从对应来源（世界书/角色卡）提取
  // marker 提示词的 content 通常是宏模板（如 '{{description}}'），applyMacros 会替换为实际字段值
  const parts: string[] = [];
  for (const p of relativePrompts) {
    let content = p.content;
    // 兼容旧数据：内置 marker 空 content 时回填宏模板
    if (p.id === 'worldInfoBefore' && !content) content = worldInfoBefore;
    if (p.id === 'worldInfoAfter' && !content) content = worldInfoAfter;
    if (p.id === 'charDescription' && !content) content = '{{description}}';
    if (p.id === 'charPersonality' && !content) content = 'Personality: {{personality}}';
    if (p.id === 'scenario' && !content) content = 'Scenario: {{scenario}}';
    if (p.id === 'dialogueExamples' && !content) content = '{{mesExamples}}';
    if (!content) continue; // 空 content（personaDescription / enhanceDefinitions 默认空）跳过
    const filled = applyMacros(content);
    if (!filled.trim()) continue; // 宏替换后为空（如角色卡对应字段为空）则跳过，避免注入空段
    parts.push(filled);
  }

  // 如果用户没有定义任何 prompts，回退到旧的硬编码逻辑
  if (relativePrompts.length === 0) {
    if (character.description) parts.push(character.description);
    if (character.personality) parts.push(`\n性格: ${character.personality}`);
    if (character.scenario) parts.push(`\n场景: ${character.scenario}`);
    if (character.postHistoryInstructions) parts.push(`\n${character.postHistoryInstructions}`);
    if (conv.systemPrompt) parts.push(`\n${conv.systemPrompt}`);
    if (worldInfoBefore || worldInfoAfter) {
      parts.push(`\n[世界书]\n${[worldInfoBefore, worldInfoAfter].filter(Boolean).join('\n\n')}`);
    }
  }

  // 对话自定义 systemPrompt（用户在创建对话时填写的）
  if (conv.systemPrompt && relativePrompts.length > 0) {
    parts.push(applyMacros(conv.systemPrompt));
  }

  // 对 in-chat prompts 也做宏替换
  const processedInChat = inChatPrompts.map((p) => ({
    ...p,
    content: applyMacros(p.content),
  }));

  return {
    systemPrompt: parts.join('\n').trim(),
    inChatPrompts: processedInChat,
  };
}

export default router;
