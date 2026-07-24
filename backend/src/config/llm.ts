export const llmConfig = {
  // 默认请求超时
  requestTimeoutMs: 60 * 1000,
  // 默认流式输出超时
  streamTimeoutMs: 120 * 1000,
  // 测试连接超时
  testTimeoutMs: 10 * 1000,
  // 默认模型参数
  defaults: {
    temperature: 1.0,
    topP: 1.0,
    maxTokens: 2048,
    presencePenalty: 0,
    frequencyPenalty: 0,
  },
  // 支持的提供商
  providers: {
    openai: {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'],
    },
    anthropic: {
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku', 'claude-3-5-sonnet'],
    },
    custom: {
      name: '自定义（OpenAI 兼容）',
      baseUrl: '',
      models: [],
    },
  },
};

export default llmConfig;
