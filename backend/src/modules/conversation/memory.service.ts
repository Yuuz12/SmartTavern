import { conversationService, userService } from '../../storage/index.js';
import { llmService } from '../llm/index.js';
import {
  logger,
  generateShortId,
  type Conversation,
  type LLMConfig,
  type MemoryCategory,
  type MemorySettings,
  type MemorySummary,
} from '../../shared/index.js';

/**
 * 默认记忆分类配置
 */
export const DEFAULT_MEMORY_CATEGORIES = [
  {
    id: 'plot',
    name: '剧情总结',
    type: 'summary' as const,
    prompt:
      '请总结以下对话的剧情发展，用简洁的叙述体书写。包括：\n- 关键情节转折与推进\n- 角色间关系的最新变化\n- 当前的主要目标与未解决的冲突\n控制在 200 字以内，聚焦于推动剧情发展的核心信息，忽略无关细节。',
    enabled: true,
    builtin: true,
  },
  {
    id: 'events',
    name: '重要事件',
    type: 'todo' as const,
    prompt:
      '请根据对话内容，维护一份重要事件 TODO 列表。\n\n重要事件包括但不限于：\n- 战斗、追逐、冲突等动作事件\n- 重大发现、决定、承诺\n- 意外遭遇、角色登场/退场\n- 物品获取或丢失\n\n规则：\n- 根据对话内容添加新的重要事件（用 [ ] 标记未完成）\n- 如果对话中某事件已经完成或解决，将其标记为 [x]\n- 保留之前已完成的事件（保持 [x] 标记）\n- 每条事件用一句话简述\n- 按时间顺序排列，最多保留 20 条\n- 直接输出更新后的完整 TODO 列表，不要添加额外说明\n\n格式：\n- [x] 已完成的事件\n- [ ] 未完成的事件',
    enabled: true,
    builtin: true,
  },
  {
    id: 'characters',
    name: '重要人物',
    type: 'tracking' as const,
    prompt:
      '请根据对话内容，维护一份重要人物状态列表。\n\n对于每位人物，记录：\n- 身份/称谓\n- 与主角的关系\n- 最新状态（位置、处境、情绪等）\n\n规则：\n- 根据对话添加新出现的重要人物\n- 更新现有人物的最新状态\n- 如果人物已离场，在状态中标注"已离场"\n- 如果人物已死亡，在状态中标注"已死亡"\n- 保留所有已出现的重要人物\n- 直接输出更新后的完整列表，不要添加额外说明\n\n格式：\n【人物名】身份 - 与主角关系 - 最新状态',
    enabled: true,
    builtin: true,
  },
];

/**
 * 默认记忆设置
 */
export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: false,
  maxContextFloors: 30,
  summaryInterval: 10,
  recentSummaryCount: 3,
  categories: DEFAULT_MEMORY_CATEGORIES,
};

/**
 * 从对话中读取记忆设置（带默认值回退）
 */
export function getMemorySettings(conv: Conversation): MemorySettings | null {
  const memory = conv.settings?.memory as MemorySettings | undefined;
  if (!memory) return null;
  return memory;
}

/**
 * 从对话中读取总结列表
 */
export function getMemorySummaries(conv: Conversation): MemorySummary[] {
  return (conv.settings?.memorySummaries as MemorySummary[] | undefined) || [];
}

/**
 * 将总结格式化为文本，追加到 systemPrompt
 * - summary 类型：注入最近 N 条分段总结
 * - todo/tracking 类型：注入单条持续更新的列表
 */
export function buildSummaryInjection(
  summaries: MemorySummary[],
  memory: MemorySettings,
): string {
  const enabledCategories = memory.categories.filter((c) => c.enabled);

  const sections: string[] = [];
  for (const cat of enabledCategories) {
    const catType = cat.type || 'summary';

    if (catType === 'summary') {
      // 分段总结：注入最近 N 条
      const catSummaries = summaries
        .filter((s) => s.categoryId === cat.id)
        .sort((a, b) => a.floorRange[1] - b.floorRange[1])
        .slice(-memory.recentSummaryCount);

      if (catSummaries.length === 0) continue;

      const content = catSummaries.map((s) => s.content).join('\n\n');
      const rangeInfo = catSummaries.length === 1
        ? `(第${catSummaries[0].floorRange[0]}-${catSummaries[0].floorRange[1]}层)`
        : `(第${catSummaries[0].floorRange[0]}-${catSummaries[catSummaries.length - 1].floorRange[1]}层)`;
      sections.push(`## ${cat.name} ${rangeInfo}\n${content}`);
    } else {
      // todo/tracking：注入最新的单条列表
      const catSummaries = summaries
        .filter((s) => s.categoryId === cat.id)
        .sort((a, b) =>
          (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
        );

      if (catSummaries.length === 0) continue;

      const latest = catSummaries[0];
      sections.push(`## ${cat.name}\n${latest.content}`);
    }
  }

  if (sections.length === 0) return '';

  return `[对话记忆总结]\n以下是之前对话的总结，帮助你理解对话背景：\n\n${sections.join('\n\n')}`;
}

/**
 * 判断是否需要生成新的总结
 * 触发条件：当前消息楼层 >= 下一总结点
 */
export function shouldGenerateSummary(
  conv: Conversation,
  memory: MemorySettings,
): boolean {
  const totalFloors = conv.messages.length;
  const summaries = getMemorySummaries(conv);

  const maxSummarizedFloor =
    summaries.length > 0
      ? Math.max(...summaries.map((s) => s.floorRange[1]))
      : 0;

  const nextSummaryPoint = maxSummarizedFloor + memory.summaryInterval;

  return totalFloors >= nextSummaryPoint;
}

/**
 * 计算本次总结需要覆盖的楼层范围
 */
export function calculateSummaryRange(
  conv: Conversation,
  memory: MemorySettings,
): [number, number] {
  const summaries = getMemorySummaries(conv);
  const maxSummarizedFloor =
    summaries.length > 0
      ? Math.max(...summaries.map((s) => s.floorRange[1]))
      : 0;

  const startFloor = maxSummarizedFloor + 1;
  const endFloor = Math.min(
    startFloor + memory.summaryInterval - 1,
    conv.messages.length,
  );

  return [startFloor, endFloor];
}

/**
 * 为 todo/tracking 类型构建更新提示词
 * 将现有列表内容 + 新对话一起发给 LLM，让 LLM 输出更新后的完整列表
 */
function buildUpdatePrompt(
  cat: MemoryCategory,
  existingContent: string | undefined,
  dialogueText: string,
  startFloor: number,
  endFloor: number,
): string {
  if (existingContent) {
    return `${cat.prompt}\n\n--- 当前列表 ---\n${existingContent}\n\n--- 最新对话内容（第${startFloor}-${endFloor}层）---\n${dialogueText}\n\n请根据最新对话内容更新列表，输出更新后的完整列表。`;
  }
  return `${cat.prompt}\n\n--- 对话内容（第${startFloor}-${endFloor}层）---\n${dialogueText}\n\n请根据对话内容生成列表。`;
}

/**
 * 生成总结（核心函数）
 * - summary 类型：生成分段总结，追加到列表
 * - todo/tracking 类型：更新现有列表或创建新列表
 * 返回完整的总结列表（含已有 + 新增/更新）
 */
export async function generateSummaries(
  conv: Conversation,
  llmConfig: LLMConfig,
  memory: MemorySettings,
): Promise<MemorySummary[]> {
  const existingSummaries = getMemorySummaries(conv);
  const [startFloor, endFloor] = calculateSummaryRange(conv, memory);

  // 提取待总结的消息（楼层 = 数组索引 + 1）
  const messagesToSummarize = conv.messages.slice(startFloor - 1, endFloor);
  const dialogueText = messagesToSummarize
    .map(
      (m) =>
        `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '角色' : '系统'}: ${m.content}`,
    )
    .join('\n\n');

  const enabledCategories = memory.categories.filter((c) => c.enabled);
  // 从现有总结开始，逐步追加/更新
  const resultSummaries = [...existingSummaries];

  for (const cat of enabledCategories) {
    const catType = cat.type || 'summary';

    try {
      let promptText: string;

      if (catType === 'summary') {
        // 分段总结：直接用分类提示词 + 对话内容
        promptText = `${cat.prompt}\n\n--- 对话内容 ---\n${dialogueText}`;
      } else {
        // todo/tracking：构建更新提示词（含现有列表）
        const existing = existingSummaries.find((s) => s.categoryId === cat.id);
        promptText = buildUpdatePrompt(
          cat,
          existing?.content,
          dialogueText,
          startFloor,
          endFloor,
        );
      }

      const result = await llmService.chatSync(
        [{ role: 'user', content: promptText }],
        llmConfig,
        {
          systemPrompt:
            '你是一个对话总结助手。请根据提供的对话内容，按照要求生成简洁准确的总结。',
          temperature: 0.3,
          maxTokens: 800,
        },
      );

      const content = result.content.trim();

      if (catType === 'summary') {
        // 分段总结：追加新总结
        resultSummaries.push({
          id: generateShortId(),
          categoryId: cat.id,
          content,
          floorRange: [startFloor, endFloor],
          createdAt: new Date().toISOString(),
        });
      } else {
        // todo/tracking：更新现有总结或创建新总结
        const existingIdx = resultSummaries.findIndex(
          (s) => s.categoryId === cat.id,
        );
        if (existingIdx >= 0) {
          const existing = resultSummaries[existingIdx];
          resultSummaries[existingIdx] = {
            ...existing,
            content,
            floorRange: [existing.floorRange[0], endFloor],
            updatedAt: new Date().toISOString(),
            isEdited: false,
          };
        } else {
          resultSummaries.push({
            id: generateShortId(),
            categoryId: cat.id,
            content,
            floorRange: [startFloor, endFloor],
            createdAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.error(`生成分类"${cat.name}"总结失败`, {
        conversationId: conv.id,
        categoryId: cat.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // 单个分类失败不影响其他分类
    }
  }

  return resultSummaries;
}

/**
 * 异步触发总结生成（AI 回复后自动调用）
 * 不阻塞 SSE 响应
 */
export async function triggerSummaryGeneration(
  conversationId: string,
  userId: string,
  llmConfig: LLMConfig,
): Promise<void> {
  const conv = await conversationService.get(conversationId, userId);
  if (!conv) return;

  const memory = getMemorySettings(conv);
  if (!memory?.enabled) return;

  if (!shouldGenerateSummary(conv, memory)) return;

  // 如果记忆设置指定了专用 LLM，优先使用
  let effectiveLlmConfig = llmConfig;
  if (memory.llmConfigId && memory.llmConfigId !== llmConfig.id) {
    const allConfigs = await userService.getLLMConfigs(userId);
    const memConfig = allConfigs.find((c) => c.id === memory.llmConfigId);
    if (memConfig) effectiveLlmConfig = memConfig;
  }

  // generateSummaries 返回完整的总结列表（含已有 + 新增/更新）
  const allSummaries = await generateSummaries(conv, effectiveLlmConfig, memory);

  // 重新获取对话（可能在生成期间有新消息），保留最新 settings
  const latestConv = await conversationService.get(conversationId, userId);
  if (!latestConv) return;

  await conversationService.update(conversationId, userId, {
    settings: { ...latestConv.settings, memorySummaries: allSummaries },
  });

  logger.info('记忆总结自动生成完成', {
    conversationId,
    totalSummaries: allSummaries.length,
  });
}
