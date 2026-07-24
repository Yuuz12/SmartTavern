import fs from 'fs-extra';
import path from 'path';
import { storageConfig } from '../config/index.js';
import {
  generateId,
  hashPassword,
  logger,
  type User,
  type UserIndexItem,
  type LLMConfig,
  type UserRole,
} from '../shared/index.js';
import { JSONStorage } from './JSONStorage.js';

/**
 * 用户存储服务
 * 用户的 LLM 配置直接嵌入用户数据中（不单独存储）
 */
export class UserService extends JSONStorage<User> {
  constructor() {
    super(storageConfig.usersDir);
  }

  protected buildIndexItem(entity: User): UserIndexItem {
    return {
      id: entity.id,
      username: entity.username,
      role: entity.role,
      avatar: entity.avatar,
      createdAt: entity.createdAt,
    };
  }

  /**
   * 创建用户
   * 首个用户自动成为管理员
   */
  async createUser(
    username: string,
    password: string,
    role?: UserRole,
  ): Promise<User> {
    // 检查用户名是否已存在
    const existing = await this.findByUsername(username);
    if (existing) {
      throw new Error(`用户名已存在: ${username}`);
    }

    const passwordHash = await hashPassword(password);

    // 第一个用户自动成为管理员
    const userCount = await this.count();
    const userRole: UserRole = role || (userCount === 0 ? 'admin' : 'user');

    const user = await this.create({
      username,
      passwordHash,
      role: userRole,
      settings: {
        theme: 'default',
        language: 'zh-CN',
        chatSettings: {
          sendShortcut: 'enter',
          streamSpeed: 'normal',
        },
      },
      llmConfigs: [],
    } as Omit<User, 'id' | 'createdAt' | 'updatedAt'>);

    logger.info('用户创建成功', { userId: user.id, username, role: userRole });
    return user;
  }

  /**
   * 按用户名查找用户
   */
  async findByUsername(username: string): Promise<User | null> {
    const users = await this.query((u) => u.username === username);
    return users[0] || null;
  }

  /**
   * 更新用户基本信息（不含密码、LLM 配置）
   */
  async updateProfile(id: string, data: Partial<Pick<User, 'username' | 'avatar' | 'settings'>>): Promise<User> {
    return this.update(id, data);
  }

  /**
   * 修改密码
   */
  async updatePassword(id: string, newPassword: string): Promise<User> {
    const passwordHash = await hashPassword(newPassword);
    return this.update(id, { passwordHash });
  }

  /**
   * 更新用户角色
   */
  async updateRole(id: string, role: UserRole): Promise<User> {
    return this.update(id, { role });
  }

  /**
   * 获取用户的 LLM 配置列表
   */
  async getLLMConfigs(userId: string): Promise<LLMConfig[]> {
    const user = await this.get(userId);
    return user?.llmConfigs || [];
  }

  /**
   * 创建 LLM 配置
   */
  async createLLMConfig(userId: string, config: Omit<LLMConfig, 'id'>): Promise<LLMConfig> {
    const user = await this.get(userId);
    if (!user) throw new Error(`用户不存在: ${userId}`);

    const newConfig: LLMConfig = {
      ...config,
      id: generateId('llm'),
    };

    // 如果是第一个配置或设为默认，清除其他默认
    const configs = [...user.llmConfigs];
    if (newConfig.isDefault || configs.length === 0) {
      configs.forEach((c) => (c.isDefault = false));
      newConfig.isDefault = true;
    }

    configs.push(newConfig);
    await this.update(userId, { llmConfigs: configs });
    return newConfig;
  }

  /**
   * 更新 LLM 配置
   */
  async updateLLMConfig(userId: string, configId: string, data: Partial<LLMConfig>): Promise<LLMConfig> {
    const user = await this.get(userId);
    if (!user) throw new Error(`用户不存在: ${userId}`);

    const idx = user.llmConfigs.findIndex((c) => c.id === configId);
    if (idx < 0) throw new Error(`LLM 配置不存在: ${configId}`);

    const updated = { ...user.llmConfigs[idx], ...data, id: configId };

    // 如果设为默认，清除其他默认
    if (data.isDefault) {
      user.llmConfigs.forEach((c) => (c.isDefault = false));
    }

    user.llmConfigs[idx] = updated;
    await this.update(userId, { llmConfigs: user.llmConfigs });
    return updated;
  }

  /**
   * 删除 LLM 配置
   */
  async deleteLLMConfig(userId: string, configId: string): Promise<boolean> {
    const user = await this.get(userId);
    if (!user) throw new Error(`用户不存在: ${userId}`);

    const idx = user.llmConfigs.findIndex((c) => c.id === configId);
    if (idx < 0) return false;

    const wasDefault = user.llmConfigs[idx].isDefault;
    user.llmConfigs.splice(idx, 1);

    // 如果删除的是默认配置，将第一个设为默认
    if (wasDefault && user.llmConfigs.length > 0) {
      user.llmConfigs[0].isDefault = true;
    }

    await this.update(userId, { llmConfigs: user.llmConfigs });
    return true;
  }

  /**
   * 获取默认 LLM 配置
   */
  async getDefaultLLMConfig(userId: string): Promise<LLMConfig | null> {
    const user = await this.get(userId);
    if (!user || !user.llmConfigs.length) return null;
    return user.llmConfigs.find((c) => c.isDefault) || user.llmConfigs[0];
  }
}

export const userService = new UserService();
