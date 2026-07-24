import http from 'http';
import fs from 'fs-extra';
import { appConfig, storageConfig } from './config/index.js';
import { logger } from './shared/index.js';
import { systemConfig } from './storage/systemConfig.js';
import { migrateToUserStorage } from './storage/migrate.js';
import app from './app.js';

/**
 * 初始化数据存储目录
 */
async function initStorage(): Promise<void> {
  const dirs = [
    storageConfig.dataPath,
    storageConfig.uploadPath,
    storageConfig.backupPath,
    storageConfig.usersDir,
    storageConfig.systemDir,
  ];

  for (const dir of dirs) {
    await fs.ensureDir(dir);
  }

  // 确保用户索引文件存在
  const usersIndexFile = `${storageConfig.usersDir}/index.json`;
  if (!await fs.pathExists(usersIndexFile)) {
    await fs.writeJson(usersIndexFile, []);
  }

  logger.info('存储目录已初始化', { dataPath: storageConfig.dataPath });
}

/**
 * 启动服务器
 */
async function startServer(): Promise<void> {
  await initStorage();

  // 迁移旧全局目录数据到按用户隔离的目录结构
  try {
    await migrateToUserStorage();
  } catch (err) {
    logger.error('数据迁移失败', { error: (err as Error).message });
  }

  await systemConfig.load();

  const server = http.createServer(app);

  server.listen(appConfig.port, () => {
    logger.info(`SmartTavern 服务已启动`, {
      port: appConfig.port,
      env: appConfig.nodeEnv,
      cors: appConfig.corsOrigin,
    });
    logger.info(`API 文档: http://localhost:${appConfig.port}/api/health`);
  });

  // 优雅关闭
  const shutdown = (signal: string) => {
    logger.info(`收到 ${signal} 信号，正在关闭服务器...`);
    server.close(() => {
      logger.info('服务器已关闭');
      process.exit(0);
    });

    // 5 秒后强制退出
    setTimeout(() => {
      logger.error('服务器关闭超时，强制退出');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 未捕获异常处理
  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', { reason });
  });
  process.on('uncaughtException', (err) => {
    logger.error('未捕获的异常', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

startServer().catch((err) => {
  logger.error('服务启动失败', { error: err.message, stack: err.stack });
  process.exit(1);
});
