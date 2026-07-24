import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authConfig } from '../../config/index.js';

/**
 * 加密密码
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, authConfig.bcryptRounds);
}

/**
 * 验证密码
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * 生成随机 ID
 */
export function generateId(prefix = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/**
 * 生成短 ID（用于消息等）
 */
export function generateShortId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * 简单加密 API Key（可逆，仅做基础混淆）
 * 生产环境应使用更安全的加密方案
 */
export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return '';
  const key = crypto.createHash('sha256').update(authConfig.jwtSecret).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * 解密 API Key
 */
export function decryptApiKey(encryptedKey: string): string {
  if (!encryptedKey) return '';
  try {
    const [ivHex, encrypted] = encryptedKey.split(':');
    if (!ivHex || !encrypted) return encryptedKey;
    const key = crypto.createHash('sha256').update(authConfig.jwtSecret).digest();
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedKey;
  }
}
