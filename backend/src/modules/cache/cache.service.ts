import crypto from 'node:crypto';
import { encode } from 'gpt-tokenizer';
import type { CacheFingerprint, CacheStats, Conversation, Message } from '../../shared/index.js';

/**
 * 缓存服务
 *
 * 缓存命中判定采用行业标准的前缀匹配算法（与 OpenAI/Anthropic 的 prompt caching 语义一致）：
 * - 每次 LLM 请求计算上下文指纹（systemPrompt 哈希 + 每条消息的 哈希/token数）
 * - 与上一次请求的指纹比对，公共前缀部分视为「缓存命中」
 * - cachedTokens = 公共前缀各消息 token 数之和
 *
 * 统计数据按需从 message.metadata 聚合，不维护累计值，确保始终准确、无同步漂移。
 */

// ============ 基础工具 ============

/** 计算字符串的 SHA-256 哈希（十六进制前 16 位，足以避免碰撞） */
function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** 估算文本 token 数（gpt-tokenizer，近似 GPT 分词） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    // 极端情况下的兜底：按 4 字符/token 估算
    return Math.ceil(text.length / 4);
  }
}

/** 估算一次请求的输入 token 数（systemPrompt + 全部消息内容） */
export function estimatePromptTokens(
  systemPrompt: string,
  messages: Array<Pick<Message, 'role' | 'content'>>,
): number {
  const promptPart = estimateTokens(systemPrompt);
  const msgPart = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  return promptPart + msgPart;
}

/** 计算单条消息的哈希（role + content，用 \0 分隔避免歧义） */
function messageHash(m: Pick<Message, 'role' | 'content'>): string {
  return sha256Hex(`${m.role}\0${m.content}`);
}

// ============ 指纹与命中判定 ============

export interface CacheHitResult {
  /** 是否命中（cachedTokens > 0） */
  hit: boolean;
  /** 命中缓存的 token 数（估算） */
  cachedTokens: number;
  /** 本次请求的指纹（供存入 cacheStats.lastContext） */
  fingerprint: CacheFingerprint;
}

/**
 * 计算本次请求的缓存命中情况
 *
 * 算法：
 * 1. 计算 systemPromptHash 与每条消息的哈希
 * 2. 与 prevContext 比对：systemPromptHash 必须相同；从前往后逐条比对消息哈希
 * 3. 公共前缀（连续相同）的消息 token 数累加为 cachedTokens
 * 4. 公共前缀部分复用 prevContext 的 token 数（避免重复 encode）；后缀部分重新 encode
 *
 * @param prev 上一次请求的指纹（来自 conv.settings.cacheStats.lastContext）
 * @param messages 本次实际发送给 LLM 的消息数组（已过滤/截断/注入/regex 处理后）
 * @param systemPrompt 本次 systemPrompt
 */
export function computeCacheHit(
  prev: CacheFingerprint | undefined,
  messages: Array<Pick<Message, 'role' | 'content'>>,
  systemPrompt: string,
): CacheHitResult {
  const systemPromptHash = sha256Hex(systemPrompt || '');
  const currentHashes = messages.map(messageHash);

  // 公共前缀长度（仅当 systemPromptHash 相同时才有前缀匹配）
  let prefixLen = 0;
  if (prev && prev.systemPromptHash === systemPromptHash) {
    const maxLen = Math.min(currentHashes.length, prev.entries.length);
    while (prefixLen < maxLen && prev.entries[prefixLen].h === currentHashes[prefixLen]) {
      prefixLen++;
    }
  }

  // 构建新指纹：前缀部分复用 prev 的 token 数，后缀部分重新估算
  const entries = currentHashes.map((h, i) => {
    if (i < prefixLen && prev) {
      return { h, t: prev.entries[i].t };
    }
    return { h, t: estimateTokens(messages[i].content) };
  });

  const cachedTokens = entries
    .slice(0, prefixLen)
    .reduce((sum, e) => sum + e.t, 0);

  // 命中判定：上一次请求的全部消息都在本次请求的前缀中完整复用才算命中
  // 即 prefixLen >= prev.entries.length（本次请求包含上一次的完整上下文作为前缀）
  // 若中间有消息被编辑/删除导致 hash 变化，前缀断裂，prefixLen < prev.entries.length，不算命中
  const hit = !!prev && prev.entries.length > 0 && prefixLen >= prev.entries.length;

  return {
    hit,
    cachedTokens,
    fingerprint: { systemPromptHash, entries },
  };
}

// ============ 聚合统计 ============

/** 从对话中读取缓存状态 */
export function getCacheStats(conv: Conversation): CacheStats | undefined {
  return conv.settings?.cacheStats as CacheStats | undefined;
}

/** 判断消息是否有缓存元数据（用于区分新旧消息） */
function hasCacheMeta(msg: Message): boolean {
  const meta = msg.metadata as Record<string, unknown> | undefined;
  return !!meta && typeof meta.cachedTokens === 'number';
}

/** 单条消息的缓存明细 */
export interface MessageCacheDetail {
  id: string;
  role: Message['role'];
  timestamp: string;
  cacheHit: boolean;
  cachedTokens: number;
  promptTokens: number;
  completionTokens: number;
}

/** 对话级缓存统计 */
export interface ConversationCacheStats {
  conversationId: string;
  /** 总消息数（含历史无缓存元数据的消息） */
  totalMessages: number;
  /** 用户消息数 */
  userMessageCount: number;
  /** AI 回复数 */
  assistantMessageCount: number;
  /** 有缓存元数据的消息数（即缓存功能启用后产生的 AI 回复数，等同已追踪请求数） */
  trackedMessages: number;
  /** 命中缓存的请求数 */
  hitCount: number;
  /** 缓存命中率（0-1） */
  hitRate: number;
  /** 累计输入 token */
  inputTokens: number;
  /** 累计输出 token */
  outputTokens: number;
  /** 累计节省 token（命中缓存的部分） */
  savedTokens: number;
  /** 每条消息的缓存明细（按时间倒序） */
  messages: MessageCacheDetail[];
}

/**
 * 聚合单个对话的缓存统计
 */
export function aggregateConversation(conv: Conversation): ConversationCacheStats {
  const details: MessageCacheDetail[] = [];
  let hitCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let savedTokens = 0;
  let tracked = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  // 预计算用户消息的 cacheHit：用户输入是 LLM 请求上下文的一部分（已纳入 computeCacheHit 的 messages），
  // 其触发的 AI 回复的缓存命中状态反映了该用户输入（作为上下文）的缓存命中情况。
  // 从后往前遍历，将每条用户消息关联到它之后（正序）的第一条 AI 回复的 cacheHit。
  const userCacheHit = new Map<string, boolean>();
  let upcomingAiHit = false;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const msg = conv.messages[i];
    const meta = (msg.metadata || {}) as Record<string, unknown>;
    if (typeof meta.cachedTokens === 'number') {
      upcomingAiHit = !!meta.cacheHit;
    } else if (msg.role === 'user') {
      userCacheHit.set(msg.id, upcomingAiHit);
    }
  }

  for (const msg of conv.messages) {
    const meta = (msg.metadata || {}) as Record<string, unknown>;
    const hasCache = typeof meta.cachedTokens === 'number';

    // 统计用户/AI 消息数（含历史无元数据的消息）
    if (msg.role === 'user') userMessageCount++;
    else if (msg.role === 'assistant') assistantMessageCount++;

    if (hasCache) {
      // AI 回复：有完整缓存元数据，参与聚合统计
      tracked++;
      const cachedTokens = (meta.cachedTokens as number) || 0;
      const promptTokens = (meta.promptTokens as number) || 0;
      const completionTokens = (meta.completionTokens as number) || 0;
      const cacheHit = !!meta.cacheHit;

      if (cacheHit) hitCount++;
      inputTokens += promptTokens;
      outputTokens += completionTokens;
      // 缓存命中时，本次请求的输入+输出 token 均视为节省（复用上次上下文，无需重新处理/生成）
      if (cacheHit) {
        savedTokens += promptTokens + completionTokens;
      }

      details.push({
        id: msg.id,
        role: msg.role,
        timestamp: msg.timestamp,
        cacheHit,
        cachedTokens,
        promptTokens,
        completionTokens,
      });
    } else {
      // 用户消息/历史消息：无独立缓存元数据，估算 token 仅供明细展示
      // 不参与聚合统计（AI 回复的 promptTokens 已包含用户消息内容，重复累加会导致虚高）
      // cacheHit 关联到它触发的 AI 回复的命中状态（用户输入作为上下文参与缓存命中判定）
      details.push({
        id: msg.id,
        role: msg.role,
        timestamp: msg.timestamp,
        cacheHit: userCacheHit.get(msg.id) || false,
        cachedTokens: 0,
        promptTokens: estimateTokens(msg.content),
        completionTokens: 0,
      });
    }
  }

  // 按时间倒序
  details.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // 命中率 = 命中请求数 / 已追踪请求数（基于请求数，直观反映上下文稳定性）
  const hitRate = tracked > 0 ? Math.min(1, hitCount / tracked) : 0;

  return {
    conversationId: conv.id,
    totalMessages: conv.messages.length,
    userMessageCount,
    assistantMessageCount,
    trackedMessages: tracked,
    hitCount,
    hitRate,
    inputTokens,
    outputTokens,
    savedTokens,
    messages: details,
  };
}

/** 全局缓存统计 */
export interface GlobalCacheStats {
  totalConversations: number;
  totalMessages: number;
  /** 有缓存元数据的消息数（缓存功能启用后产生的消息） */
  trackedMessages: number;
  /** 命中缓存的请求数 */
  hitCount: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  /** 全局缓存命中率（命中请求数 / 已追踪请求数，clamp 0-1） */
  globalHitRate: number;
}

/**
 * 聚合全局缓存统计（跨用户全部对话）
 */
export function aggregateGlobal(convs: Conversation[]): GlobalCacheStats {
  let totalMessages = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let savedTokens = 0;
  let hitCount = 0;
  let trackedMessages = 0;

  for (const conv of convs) {
    totalMessages += conv.messages.length;
    for (const msg of conv.messages) {
      const meta = (msg.metadata || {}) as Record<string, unknown>;
      if (typeof meta.cachedTokens !== 'number') continue; // 仅统计有缓存元数据的消息
      trackedMessages++;
      const promptTokens = (meta.promptTokens as number) || 0;
      const completionTokens = (meta.completionTokens as number) || 0;
      const cacheHit = !!meta.cacheHit;
      inputTokens += promptTokens;
      outputTokens += completionTokens;
      // 缓存命中时，本次请求的输入+输出 token 均视为节省
      if (cacheHit) {
        hitCount++;
        savedTokens += promptTokens + completionTokens;
      }
    }
  }

  return {
    totalConversations: convs.length,
    totalMessages,
    trackedMessages,
    hitCount,
    inputTokens,
    outputTokens,
    savedTokens,
    globalHitRate: trackedMessages > 0 ? Math.min(1, hitCount / trackedMessages) : 0,
  };
}

/** 热力图单日数据 */
export interface HeatmapDay {
  /** YYYY-MM-DD */
  date: string;
  /** 当天消息数 */
  count: number;
}

/**
 * 生成最近 N 天的聊天热力图（按天统计全局消息数，补零）
 * @param convs 全部对话
 * @param days 天数（默认 90，约 3 个月）
 */
export function aggregateHeatmap(convs: Conversation[], days = 90): HeatmapDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 初始化最近 days 天为 0
  const map = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    map.set(formatDate(d), 0);
  }

  // 统计每条消息所属日期
  for (const conv of convs) {
    for (const msg of conv.messages) {
      const date = formatDate(new Date(msg.timestamp));
      if (map.has(date)) {
        map.set(date, (map.get(date) || 0) + 1);
      }
    }
  }

  return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
}

/** 格式化日期为 YYYY-MM-DD（本地时区） */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
