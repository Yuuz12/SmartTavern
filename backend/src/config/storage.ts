import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 后端根目录（backend/）
const backendRoot = path.resolve(__dirname, '..', '..');

export const storageConfig = {
  dataPath: path.resolve(backendRoot, process.env.DATA_PATH || './data'),
  uploadPath: path.resolve(backendRoot, process.env.UPLOAD_PATH || './uploads'),
  backupPath: path.resolve(backendRoot, process.env.BACKUP_PATH || './backups'),
  // 各模块数据目录
  usersDir: '',
  charactersDir: '',
  worldbooksDir: '',
  conversationsDir: '',
  systemDir: '',
};

// 初始化各模块目录路径
storageConfig.usersDir = path.join(storageConfig.dataPath, 'users');
storageConfig.charactersDir = path.join(storageConfig.dataPath, 'characters');
storageConfig.worldbooksDir = path.join(storageConfig.dataPath, 'worldbooks');
storageConfig.conversationsDir = path.join(storageConfig.dataPath, 'conversations');
storageConfig.systemDir = path.join(storageConfig.dataPath, 'system');

export default storageConfig;
