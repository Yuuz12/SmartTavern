import type { LLMConfig, Message } from '../../shared/index.js';

/**
 * 流式输出的文本块类型
 * - text: 正文内容
 * - thinking: 思维链内容（reasoning）
 */
export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string };

/**
 * LLM 适配器统一接口
 */
export interface LLMProvider {
  /**
   * 流式对话
   * @returns AsyncGenerator 产出 StreamChunk
   */
  chat(
    messages: Array<Pick<Message, 'role' | 'content'>>,
    config: LLMConfig,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      stop?: string[];
      signal?: AbortSignal;
    },
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * 同步对话（一次性返回完整响应）
   */
  chatSync(
    messages: Array<Pick<Message, 'role' | 'content'>>,
    config: LLMConfig,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      stop?: string[];
    },
  ): Promise<{ content: string; tokens?: number }>;

  /**
   * 测试连接
   */
  testConnection(config: LLMConfig): Promise<{ success: boolean; message: string }>;
}

/**
 * 提取配置参数
 */
export function extractParams(config: LLMConfig, overrides?: Record<string, unknown>) {
  const extra = config.extraParams || {};
  return {
    temperature: (overrides?.temperature as number) ?? extra.temperature ?? 1.0,
    topP: extra.topP ?? 1.0,
    maxTokens: (overrides?.maxTokens as number) ?? extra.maxTokens ?? 2048,
    presencePenalty: extra.presencePenalty ?? 0,
    frequencyPenalty: extra.frequencyPenalty ?? 0,
    stop: (overrides?.stop as string[]) ?? extra.stop,
    topK: extra.topK,
  };
}
