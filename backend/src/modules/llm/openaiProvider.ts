import { decryptApiKey, logger } from '../../shared/index.js';
import { llmConfig } from '../../config/index.js';
import type { LLMProvider, StreamChunk } from './llmProvider.js';
import { extractParams } from './llmProvider.js';
import type { LLMConfig, Message } from '../../shared/index.js';

/**
 * OpenAI 兼容提供商适配器
 * 支持 OpenAI 官方、Azure OpenAI、Ollama、LocalAI、DeepSeek、Qwen 等兼容接口
 * 支持 reasoning_content 思维链（DeepSeek-R1、Qwen3、OpenAI o-series 等）
 */
export class OpenAIProvider implements LLMProvider {
  private getHeaders(config: LLMConfig): Record<string, string> {
    const apiKey = decryptApiKey(config.apiKey);
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  private getUrl(config: LLMConfig, path: string): string {
    const baseUrl = (config.baseUrl || llmConfig.providers.openai.baseUrl).replace(/\/$/, '');
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
    const fullMessages = this.buildMessages(messages, options?.systemPrompt);

    const body: Record<string, unknown> = {
      model: config.model,
      messages: fullMessages,
      temperature: params.temperature,
      top_p: params.topP,
      max_tokens: params.maxTokens,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      ...(params.stop ? { stop: params.stop } : {}),
      stream: true,
    };

    // 支持 OpenAI o-series 的 reasoning 参数
    if (config.extraParams?.reasoningEffort) {
      body.reasoning_effort = config.extraParams.reasoningEffort;
    }

    const response = await fetch(this.getUrl(config, '/chat/completions'), {
      method: 'POST',
      headers: this.getHeaders(config),
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('OpenAI 流式请求失败', { status: response.status, body: errText });
      throw new Error(`OpenAI API 错误 (${response.status}): ${errText}`);
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
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return;

          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            if (!delta) continue;

            // 思维链内容（DeepSeek-R1、Qwen3 等使用 reasoning_content）
            if (delta.reasoning_content) {
              yield { type: 'thinking', content: delta.reasoning_content as string };
            }
            // OpenAI o-series 使用 reasoning 字段
            if (delta.reasoning) {
              yield { type: 'thinking', content: delta.reasoning as string };
            }
            // 正文内容
            if (delta.content) {
              yield { type: 'text', content: delta.content as string };
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
    const fullMessages = this.buildMessages(messages, options?.systemPrompt);

    const body = {
      model: config.model,
      messages: fullMessages,
      temperature: params.temperature,
      top_p: params.topP,
      max_tokens: params.maxTokens,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      ...(params.stop ? { stop: params.stop } : {}),
    };

    const response = await fetch(this.getUrl(config, '/chat/completions'), {
      method: 'POST',
      headers: this.getHeaders(config),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API 错误 (${response.status}): ${errText}`);
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { total_tokens: number };
    };

    return {
      content: json.choices[0]?.message?.content || '',
      tokens: json.usage?.total_tokens,
    };
  }

  async testConnection(config: LLMConfig): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(this.getUrl(config, '/models'), {
        method: 'GET',
        headers: this.getHeaders(config),
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

  private buildMessages(
    messages: Array<Pick<Message, 'role' | 'content'>>,
    systemPrompt?: string,
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }
    for (const msg of messages) {
      result.push({ role: msg.role, content: msg.content });
    }
    return result;
  }
}

export const openaiProvider = new OpenAIProvider();
