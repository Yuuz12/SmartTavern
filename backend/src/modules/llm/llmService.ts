import type { LLMConfig, Message } from '../../shared/index.js';
import type { LLMProvider, StreamChunk } from './llmProvider.js';
import { openaiProvider } from './openaiProvider.js';
import { anthropicProvider } from './anthropicProvider.js';

/**
 * LLM 服务 - 根据配置选择合适的提供商
 */
export class LLMService {
  private providers: Record<string, LLMProvider> = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    // custom 类型默认使用 OpenAI 兼容适配器
    custom: openaiProvider,
  };

  /**
   * 获取提供商
   */
  getProvider(provider: string): LLMProvider {
    return this.providers[provider] || this.providers.openai;
  }

  /**
   * 流式对话
   */
  async *chat(
    messages: Array<Pick<Message, 'role' | 'content'>>,
    config: LLMConfig,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      stop?: string[];
      signal?: AbortSignal;
    },
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const provider = this.getProvider(config.provider);
    yield* provider.chat(messages, config, options);
  }

  /**
   * 同步对话
   */
  async chatSync(
    messages: Array<Pick<Message, 'role' | 'content'>>,
    config: LLMConfig,
    options?: { systemPrompt?: string; temperature?: number; maxTokens?: number; stop?: string[] },
  ): Promise<{ content: string; tokens?: number }> {
    const provider = this.getProvider(config.provider);
    return provider.chatSync(messages, config, options);
  }

  /**
   * 测试连接
   */
  async testConnection(config: LLMConfig): Promise<{ success: boolean; message: string }> {
    const provider = this.getProvider(config.provider);
    return provider.testConnection(config);
  }
}

export const llmService = new LLMService();
