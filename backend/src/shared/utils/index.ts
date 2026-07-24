export { default as logger } from './logger.js';
export * from './crypto.js';
export * from './validator.js';
export * from './regex.js';

/**
 * 安全解析 JSON，失败返回 null
 */
export function safeJsonParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 移除对象中的敏感字段
 */
export function omitSensitive<T extends Record<string, unknown>>(
  obj: T,
  fields: string[] = ['passwordHash', 'apiKey'],
): Partial<T> {
  const result = { ...obj };
  fields.forEach((f) => {
    delete result[f as keyof T];
  });
  return result;
}

/**
 * 格式化日期为 ISO 字符串
 */
export function nowISO(): string {
  return new Date().toISOString();
}
