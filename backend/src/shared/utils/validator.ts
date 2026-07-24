/**
 * 密码强度校验
 * 至少 8 位，包含大小写字母和数字
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return { valid: false, message: '密码长度至少 8 位' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: '密码需包含小写字母' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: '密码需包含大写字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: '密码需包含数字' };
  }
  return { valid: true };
}

/**
 * 用户名校验
 * 3-32 位，支持字母、数字、下划线、中文
 */
export function validateUsername(username: string): { valid: boolean; message?: string } {
  if (!username || username.length < 3) {
    return { valid: false, message: '用户名长度至少 3 位' };
  }
  if (username.length > 32) {
    return { valid: false, message: '用户名长度不能超过 32 位' };
  }
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
    return { valid: false, message: '用户名只能包含字母、数字、下划线和中文' };
  }
  return { valid: true };
}

/**
 * 邮箱校验
 */
export function validateEmail(email: string): { valid: boolean; message?: string } {
  if (!email) return { valid: false, message: '邮箱不能为空' };
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) {
    return { valid: false, message: '邮箱格式不正确' };
  }
  return { valid: true };
}

/**
 * 字符串非空校验
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 校验对象是否包含必需字段
 */
export function validateRequired(obj: Record<string, unknown>, fields: string[]): { valid: boolean; missing: string[] } {
  const missing = fields.filter((f) => !isNonEmptyString(obj[f]));
  return { valid: missing.length === 0, missing };
}
