import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import { appConfig, storageConfig } from './config/index.js';
import { globalLimiter, errorHandler, notFoundHandler } from './middleware/index.js';
import { logger } from './shared/index.js';

// 路由
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/user/user.routes.js';
import characterRoutes from './modules/character/character.routes.js';
import worldbookRoutes from './modules/worldbook/worldbook.routes.js';
import conversationRoutes from './modules/conversation/conversation.routes.js';
import llmConfigRoutes from './modules/llm-config/llmConfig.routes.js';
import systemRoutes from './modules/system/system.routes.js';
import fileRoutes from './modules/file/file.routes.js';
import cacheRoutes from './modules/cache/cache.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ============ 基础中间件 ============
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(
  cors({
    origin: appConfig.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(globalLimiter);

// 请求日志
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.url}`, { ip: req.ip });
  next();
});

// ============ 静态文件（用户上传，按用户隔离） ============
app.use('/uploads/:userId', (req, res, next) => {
  const { userId } = req.params;
  // 路径穿越防护
  if (/[\/\\]|\.\./.test(userId)) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '非法路径' } });
    return;
  }
  const userUploadDir = path.join(storageConfig.dataPath, 'users', userId, 'uploads');
  express.static(userUploadDir, {
    maxAge: '7d',
    fallthrough: true,
  })(req, res, next);
});

// ============ API 路由 ============
// API 响应一律不缓存，避免统计数据/对话列表等过期（浏览器启发式缓存可能导致显示旧数据）
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/worldbooks', worldbookRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/llm-configs', llmConfigRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/cache', cacheRoutes);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// ============ 前端伪静态路由重写 ============
// 将 /chat、/login 等简洁路径映射到对应 HTML 文件
const pageRewrites: Record<string, string> = {
  '/chat': '/pages/chat.html',
  '/login': '/pages/login.html',
  '/characters': '/pages/characters.html',
  '/worldbooks': '/pages/worldbooks.html',
  '/settings': '/pages/settings.html',
};
app.use((req, _res, next) => {
  const target = pageRewrites[req.path];
  if (target) {
    const queryIndex = req.url.indexOf('?');
    const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
    req.url = target + query;
  }
  next();
});

// ============ 前端静态文件（生产环境） ============
const frontendPath = path.resolve(__dirname, '..', '..', 'frontend');
if (await fs.pathExists(frontendPath)) {
  app.use(express.static(frontendPath, { maxAge: appConfig.isDev ? 0 : '1d' }));
  // SPA 回退：非 /api 路径返回 index.html
  app.get('*', (req, res, next) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
      return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// ============ 错误处理 ============
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
