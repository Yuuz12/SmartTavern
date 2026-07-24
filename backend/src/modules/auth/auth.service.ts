import jwt, { type SignOptions } from 'jsonwebtoken';
import { authConfig } from '../../config/index.js';
import type { JwtPayload, User } from '../../shared/index.js';

/**
 * 生成 Access Token
 */
export function generateAccessToken(user: User): string {
  const payload: JwtPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    type: 'access',
  };
  const options: SignOptions = {
    expiresIn: authConfig.jwtExpiresIn as unknown as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, authConfig.jwtSecret, options);
}

/**
 * 生成 Refresh Token
 */
export function generateRefreshToken(user: User): string {
  const payload: JwtPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    type: 'refresh',
  };
  const options: SignOptions = {
    expiresIn: authConfig.jwtRefreshExpiresIn as unknown as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, authConfig.jwtSecret, options);
}

/**
 * 生成令牌对
 */
export function generateTokenPair(user: User): { accessToken: string; refreshToken: string } {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user),
  };
}

/**
 * 验证 Refresh Token
 */
export function verifyRefreshToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
    if (payload.type !== 'refresh') return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * 生成新的 Access Token
 */
export function refreshAccessToken(refreshToken: string): string | null {
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return null;
  const options: SignOptions = {
    expiresIn: authConfig.jwtExpiresIn as unknown as SignOptions['expiresIn'],
  };
  return jwt.sign(
    {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
      type: 'access',
    },
    authConfig.jwtSecret,
    options,
  );
}
