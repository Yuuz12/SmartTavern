import { decryptApiKey, logger } from '../../shared/index.js';
import { llmConfig } from '../../config/index.js';
import type { LLMProvider, StreamChunk } from './llmProvider.js';
import { extractParams } from './llmProvider.js';
import type { LLMConfig, Message } from '../../shared/index.js';

/**
 * Anthropic Claude 适配器
 * 支持原生 Anthropic API 和 extended thinking（思维链）
 */
export class AnthropicProvider implements LLMProvider {
  private getHeaders(config: LLMConfig): Record<string, string> {
    const apiKey = decryptApiKey(config.apiKey);
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private getUrl(config: LLMConfig, path: string): string {
    const baseUrl = (config.baseUrl || llmConfig.providers.anthropic.baseUrl).replace(/\/$/, '');
    return `${baseUrl}${path}`;
  }

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
    const params = extractParams(config, options);
    const anthropicMessages = this.buildMessages(messages);

    const body: Record<string, unknown> = {
      model: config.model,
      messages: anthropicMessages,
      system: options?.systemPrompt,
      temperature: params.temperature,
      top_p: params.topP,
      max_tokens: params.maxTokens,
      ...(params.stop ? { stop_sequences: params.stop } : {}),
      stream: true,
    };

    // 支持 extended thinking（Claude 3.7+ 的 extended thinking）
    if (config.extraParams?.thinking) {
      const thinking = config.extraParams.thinking as { type: string; budget_tokens: number };
      body.thinking = thinking;
      // 启用 thinking 时 temperature 必须为 1
      body.temperature = 1;
    }

    const response = await fetch(this.getUrl(config, '/v1/messages'), {
      method: 'POST',
      headers: this.getHeaders(config),
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Anthropic 流式请求失败', { status: response.status, body: errText });
      throw new Error(`Anthropic API 错误 (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error('响应体为空');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            // 思维链内容（extended thinking）
            if (json.type === 'content_block_delta' && json.delta?.type === 'thinking_delta') {
              if (json.delta.thinking) {
                yield { type: 'thinking', content: json.delta.thinking as string };
              }
            }
            // 正文内容
            if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
              if (json.delta.text) {
                yield { type: 'text', content: json.delta.text as string };
              }
            }
            // 兼容旧版无 type 字段的 delta
            if (json.type === 'content_block_delta' && json.delta?.text && !json.delta?.type) {
              yield { type: 'text', content: json.delta.text as string };
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chatSync(
    messages: Array<Pick<Message, 'role' | 'content'>>,
    config: LLMConfig,
    options?: { systemPrompt?: string; temperature?: number; maxTokens?: number; stop?: string[] },
  ): Promise<{ content: string; tokens?: number }> {
    const params = extractParams(config, options);
    const anthropicMessages = this.buildMessages(messages);

    const body = {
      model: config.model,
      messages: anthropicMessages,
      system: options?.systemPrompt,
      temperature: params.temperature,
      top_p: params.topP,
      max_tokens: params.maxTokens,
      ...(params.stop ? { stop_sequences: params.stop } : {}),
    };

    const response = await fetch(this.getUrl(config, '/v1/messages'), {
      method: 'POST',
      headers: this.getHeaders(config),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API 错误 (${response.status}): ${errText}`);
    }

    const json = (await response.json()) as {
      content: Array<{ text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const content = json.content.map((c) => c.text).join('');
    return {
      content,
      tokens: json.usage ? json.usage.input_tokens + json.usage.output_tokens : undefined,
    };
  }

  async testConnection(config: LLMConfig): Promise<{ success: boolean; message: string }> {
    try {
      // 用一个极简请求测试连接
      const response = await fetch(this.getUrl(config, '/v1/messages'), {
        method: 'POST',
        headers: this.getHeaders(config),
        body: JSON.stringify({
          model: config.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(llmConfig.testTimeoutMs),
      });

      if (response.ok) {
        return { success: true, message: '连接成功' };
      }
      const errText = await response.text();
      return { success: false, message: `连接失败 (${response.status}): ${errText}` };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : '连接失败',
      };
    }
  }

  /**
   * Anthropic 不支持 system 角色，需要单独传递
   */
  private buildMessages(
    messages: Array<Pick<Message, 'role' | 'content'>>,
  ): Array<{ role: string; content: string }> {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));
  }
}

export const anthropicProvider = new AnthropicProvider();
