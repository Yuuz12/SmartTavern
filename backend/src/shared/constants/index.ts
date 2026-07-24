// 用户角色
export const USER_ROLES = {
  ADMIN: 'admin' as const,
  USER: 'user' as const,
};

// 错误代码
export const ERROR_CODES = {
  // 认证错误
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  AUTH_USER_EXISTS: 'AUTH_USER_EXISTS',
  AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'AUTH_PASSWORD_CHANGE_REQUIRED',

  // 验证错误
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // 资源错误
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',

  // 限流
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // LLM 错误
  LLM_CONFIG_NOT_FOUND: 'LLM_CONFIG_NOT_FOUND',
  LLM_REQUEST_FAILED: 'LLM_REQUEST_FAILED',
  LLM_STREAM_ERROR: 'LLM_STREAM_ERROR',

  // 系统错误
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
} as const;

// 文件上传允许的类型
export const ALLOWED_FILE_TYPES = {
  images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  json: ['application/json'],
  png: ['image/png'],
} as const;

// 默认世界书设置
export const DEFAULT_WORLDBOOK_SETTINGS = {
  scanDepth: 2,
  budgetDefault: 100,
} as const;

// 消息角色
export const MESSAGE_ROLES = {
  USER: 'user' as const,
  ASSISTANT: 'assistant' as const,
  SYSTEM: 'system' as const,
} as const;
