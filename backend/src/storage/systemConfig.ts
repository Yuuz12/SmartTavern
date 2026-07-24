import fs from 'fs-extra';
import path from 'path';
import { storageConfig } from '../config/index.js';
import { logger } from '../shared/index.js';

export interface SystemConfig {
  registrationEnabled: boolean;
}

const DEFAULT_CONFIG: SystemConfig = {
  registrationEnabled: true,
};

class SystemConfigService {
  private configPath: string;
  private config: SystemConfig = { ...DEFAULT_CONFIG };
  private loaded = false;

  constructor() {
    this.configPath = path.join(storageConfig.systemDir, 'config.json');
  }

  async load(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.configPath));
      if (await fs.pathExists(this.configPath)) {
        const content = await fs.readFile(this.configPath, 'utf8');
        const data = JSON.parse(content);
        this.config = { ...DEFAULT_CONFIG, ...data };
      } else {
        this.config = { ...DEFAULT_CONFIG };
        await this.save();
      }
    } catch (err) {
      logger.warn('加载系统配置失败，使用默认配置', { error: (err as Error).message });
      this.config = { ...DEFAULT_CONFIG };
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.configPath));
    const tmpFile = `${this.configPath}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(this.config, null, 2), 'utf8');
    await fs.rename(tmpFile, this.configPath);
  }

  get(): SystemConfig {
    return { ...this.config };
  }

  async update(patch: Partial<SystemConfig>): Promise<SystemConfig> {
    if (!this.loaded) await this.load();
    this.config = { ...this.config, ...patch };
    await this.save();
    logger.info('系统配置已更新', { config: this.config });
    return this.get();
  }
}

export const systemConfig = new SystemConfigService();
