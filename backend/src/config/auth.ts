export const authConfig = {
  jwtSecret: process.env.JWT_SECRET || 'smarttavern_default_jwt_secret_change_in_production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  bcryptRounds: 10,
  // 登录失败次数限制
  loginMaxAttempts: 5,
  loginLockWindowMs: 15 * 60 * 1000, // 15 分钟
};

export default authConfig;
