// ============ 用户相关类型 ============

export type UserRole = 'admin' | 'user';

export interface UserSettings {
  theme?: string;
  language?: string;
  chatSettings?: {
    sendShortcut?: 'enter' | 'ctrl+enter';
    streamSpeed?: 'slow' | 'normal' | 'fast';
  };
}

export interface LLMConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'custom';
  apiKey: string;
  baseUrl?: string;
  model: string;
  isDefault?: boolean;
  extraParams?: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    stop?: string[];
    topK?: number;
    [key: string]: unknown;
  };
}

// ============ 正则脚本类型 ============

export interface RegexScript {
  id: string;
  name: string;
  /** 查找正则表达式（支持 /pattern/flags 格式） */
  findRegex: string;
  /** 替换字符串（支持 $1, $2, {{match}} 等） */
  replaceWith: string;
  /** 从匹配文本中先移除的内容（多行分隔） */
  trimOut?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 作用目标 */
  affects: {
    display: boolean;
    userInput: boolean;
    prompt: boolean;
  };
  /** 作用范围：global=全局, characterId=角色限定 */
  scope: 'global' | string;
  /** 最小深度（0=最后一条消息，-1=不限） */
  minDepth?: number;
  /** 最大深度（-1=不限） */
  maxDepth?: number;
  /** 排序权重 */
  order: number;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  avatar?: string;
  /** 管理员创建的用户首次登录时必须修改密码 */
  mustChangePassword?: boolean;
  createdAt: string;
  updatedAt: string;
  settings: UserSettings;
  llmConfigs: LLMConfig[];
  regexScripts?: RegexScript[];
}

// 用户索引（不含敏感信息）
export interface UserIndexItem {
  id: string;
  username: string;
  role: UserRole;
  avatar?: string;
  createdAt: string;
  [key: string]: unknown;
}

// ============ 角色卡类型 ============

export interface Character {
  id: string;
  userId: string;
  name: string;
  avatar?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  mesExample?: string;
  firstMes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  alternateGreetings?: string[];
  creator?: string;
  characterVersion?: string;
  tags?: string[];
  spec?: string;
  specVersion?: string;
  /** 绑定的世界书 ID 列表 */
  worldBookIds?: string[];
  extensions?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterIndexItem {
  id: string;
  userId: string;
  name: string;
  avatar?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

// ============ 世界书类型 ============

export interface WorldbookEntry {
  uid: string;
  keys: string[];
  content: string;
  enabled: boolean;
  insertionOrder: number;
  caseSensitive: boolean;
  name?: string;
  priority: number;
  id: number;
  comment?: string;
  selective: boolean;
  secondaryKeys: string[];
  constant: boolean;
  position: 'before' | 'after';
  extensions?: Record<string, unknown>;
}

export interface Worldbook {
  id: string;
  userId: string;
  name: string;
  description?: string;
  /** 来源角色卡 ID：从角色卡内嵌 character_book 导入时记录，用于随角色卡级联删除与导出 */
  sourceCharacterId?: string;
  settings: {
    scanDepth: number;
    budgetDefault: number;
    [key: string]: unknown;
  };
  entries: WorldbookEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface WorldbookIndexItem {
  id: string;
  userId: string;
  name: string;
  description?: string;
  entryCount: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

// ============ 对话类型 ============

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  isEdited?: boolean;
  /** 多个备选回复（swipe），content = swipes[swipeIndex] */
  swipes?: string[];
  /** 每个 swipe 对应的思维链，与 swipes 索引一一对应 */
  swipeThinkings?: string[];
  /** 当前显示的 swipe 索引 */
  swipeIndex?: number;
  metadata?: {
    tokens?: number;
    duration?: number;
    model?: string;
    [key: string]: unknown;
  };
}

export interface Conversation {
  id: string;
  userId: string;
  characterId: string;
  llmConfigId: string;
  title: string;
  systemPrompt?: string;
  worldBookIds: string[];
  settings: {
    temperature?: number;
    maxTokens?: number;
    /** Prompt Manager 中的提示词列表（按此列表顺序构建 system prompt） */
    prompts?: ConversationPrompt[];
    [key: string]: unknown;
  };
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Prompt Manager 中的提示词条目
 * - injection_position: 0 = relative（拼到 system prompt 中），1 = in-chat（作为独立 system message 插入聊天历史）
 * - injection_depth: 注入深度（仅在 in-chat 时有效，0 表示最新消息之前，>0 表示往历史 N 条之前插入）
 * - injection_order: 同位置同深度内的排序（升序）
 */
export interface ConversationPrompt {
  id: string;
  name: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  enabled: boolean;
  injection_position: 0 | 1;
  injection_depth: number;
  injection_order: number;
}

export interface ConversationIndexItem {
  id: string;
  userId: string;
  characterId: string;
  characterName?: string;
  title: string;
  messageCount: number;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

// ============ 记忆功能类型 ============

/**
 * 记忆分类定义
 * 内置三个分类：plot（剧情总结）、events（重要事件）、characters（重要人物）
 * 用户可自定义新分类
 */
export interface MemoryCategory {
  /** 唯一标识，内置分类用固定 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 该分类的总结提示词 */
  prompt: string;
  /** 是否启用（剧情总结始终为 true，不可关闭） */
  enabled: boolean;
  /** 是否为内置分类（内置不可删除） */
  builtin: boolean;
  /** 分类类型：summary=分段总结（每N层生成新总结），todo=TODO列表（持续更新），tracking=状态追踪（持续更新） */
  type?: 'summary' | 'todo' | 'tracking';
}

/**
 * 单条记忆总结
 */
export interface MemorySummary {
  id: string;
  /** 所属分类 ID */
  categoryId: string;
  /** 总结内容 */
  content: string;
  /** 本次总结覆盖的消息楼层范围 [startFloor, endFloor] */
  floorRange: [number, number];
  /** 生成时间 */
  createdAt: string;
  /** 最后更新时间（todo/tracking 类型每次更新时刷新） */
  updatedAt?: string;
  /** 是否手动编辑过 */
  isEdited?: boolean;
}

/**
 * 记忆功能设置（存储在 conv.settings.memory 中）
 */
export interface MemorySettings {
  /** 是否启用记忆功能 */
  enabled: boolean;
  /** 发送给 LLM 的最大消息层数（超过此值的旧消息被截断，0 = 不限） */
  maxContextFloors: number;
  /** 每隔 N 层总结一次（默认 10） */
  summaryInterval: number;
  /** 发送给 LLM 的最新总结条数（默认 3） */
  recentSummaryCount: number;
  /** 分类配置列表 */
  categories: MemoryCategory[];
  /** 总结专用 LLM 配置 ID（留空则跟随对话 LLM） */
  llmConfigId?: string;
}

// ============ 缓存功能类型 ============

/**
 * 缓存指纹单条目：单条消息的哈希与 token 数
 * - h: sha256(role + '\0' + content) 的十六进制前缀
 * - t: 该消息内容的 token 数（gpt-tokenizer 估算）
 */
export interface CacheFingerprintEntry {
  h: string;
  t: number;
}

/**
 * 缓存指纹：描述一次 LLM 请求的完整上下文（systemPrompt + messages）
 * 用于与上一次请求比对，判定缓存命中
 */
export interface CacheFingerprint {
  /** systemPrompt 的哈希 */
  systemPromptHash: string;
  /** 每条消息的指纹条目（按发送顺序） */
  entries: CacheFingerprintEntry[];
}

/**
 * 缓存统计状态（存储在 conv.settings.cacheStats 中）
 * 仅保存上一次请求的指纹用于下一次命中判定，不保存累计值（累计值按需聚合）
 */
export interface CacheStats {
  lastContext: CacheFingerprint;
}

/**
 * 消息级缓存元数据（扩展 Message.metadata）
 */
export interface MessageCacheMetadata {
  /** 输入 token 数（含 systemPrompt + 全部消息） */
  promptTokens?: number;
  /** 输出 token 数 */
  completionTokens?: number;
  /** 本次请求命中缓存的 token 数（估算） */
  cachedTokens?: number;
  /** 是否命中缓存 */
  cacheHit?: boolean;
}

// ============ API 响应类型 ============

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface QueryOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filter?: Record<string, unknown>;
}

// ============ JWT 载荷 ============

export interface JwtPayload {
  userId: string;
  username: string;
  role: UserRole;
  type?: 'access' | 'refresh';
}
