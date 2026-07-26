import fs from 'fs-extra';
import path from 'path';
import { storageConfig } from '../config/index.js';
import {
  generateShortId,
  type Conversation,
  type ConversationIndexItem,
  type Message,
} from '../shared/index.js';
import { JSONStorage } from './JSONStorage.js';
import { characterService } from './characterService.js';

/**
 * 对话存储服务
 * 按用户物理隔离：每个用户的对话存放在 data/users/{userId}/conversations/
 */
export class ConversationService {
  /** 每个用户一个 JSONStorage 实例 */
  private storages = new Map<string, JSONStorage<Conversation>>();

  /** 获取（或创建）某用户的存储实例 */
  private getStorage(userId: string): JSONStorage<Conversation> {
    let s = this.storages.get(userId);
    if (!s) {
      const dir = path.join(storageConfig.dataPath, 'users', userId, 'conversations');
      s = new JSONStorage<Conversation>(dir);
      this.storages.set(userId, s);
    }
    return s;
  }

  /** 供迁移脚本使用 */
  getStorageForMigration(userId: string): JSONStorage<Conversation> {
    return this.getStorage(userId);
  }

  /**
   * 获取用户的对话列表（带角色名）
   * @param characterId 可选，按角色过滤
   */
  async getByUserId(userId: string, search?: string, characterId?: string): Promise<ConversationIndexItem[]> {
    const storage = this.getStorage(userId);
    const items = await storage.query((c) => {
      if (characterId && c.characterId !== characterId) return false;
      if (search) {
        return c.title.toLowerCase().includes(search.toLowerCase());
      }
      return true;
    });

    // 获取角色名映射
    const charNames = await characterService.getCharacterNames(userId);

    const result = items
      .map((c) => this.buildIndexItem(c))
      .map((item) => ({
        ...item,
        characterName: charNames.get(item.characterId) || '未知角色',
      }));

    result.sort((a, b) => (b.lastMessageAt || b.updatedAt).localeCompare(a.lastMessageAt || a.updatedAt));
    return result;
  }

  /**
   * 获取用户的全部对话（含完整消息，并行读取）
   * 供缓存统计/热力图等按需聚合场景使用
   */
  async getAllFullByUserId(userId: string): Promise<Conversation[]> {
    const storage = this.getStorage(userId);
    return storage.getAllEntities();
  }

  /** 构建索引项 */
  private buildIndexItem(entity: Conversation): ConversationIndexItem {
    return {
      id: entity.id,
      userId: entity.userId,
      characterId: entity.characterId,
      title: entity.title,
      messageCount: entity.messages.length,
      lastMessageAt: entity.messages.length > 0
        ? entity.messages[entity.messages.length - 1].timestamp
        : undefined,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * 获取单个对话
   */
  async get(id: string, userId: string): Promise<Conversation | null> {
    return this.getStorage(userId).get(id);
  }

  /**
   * 创建对话
   */
  async createConversation(data: {
    userId: string;
    characterId: string;
    llmConfigId: string;
    title: string;
    systemPrompt?: string;
    worldBookIds?: string[];
    settings?: Conversation['settings'];
    initialMessages?: Message[];
  }): Promise<Conversation> {
    const storage = this.getStorage(data.userId);
    return storage.create({
      userId: data.userId,
      characterId: data.characterId,
      llmConfigId: data.llmConfigId,
      title: data.title,
      systemPrompt: data.systemPrompt,
      worldBookIds: data.worldBookIds || [],
      settings: data.settings || {},
      messages: data.initialMessages || [],
    } as Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>);
  }

  /**
   * 更新对话
   */
  async update(id: string, userId: string, data: Partial<Conversation>): Promise<Conversation> {
    return this.getStorage(userId).update(id, data);
  }

  /**
   * 删除对话
   */
  async delete(id: string, userId: string): Promise<boolean> {
    return this.getStorage(userId).delete(id);
  }

  /**
   * 添加消息
   */
  async addMessage(conversationId: string, userId: string, message: { role: Message['role']; content: string; metadata?: Message['metadata'] }): Promise<Message> {
    const conv = await this.get(conversationId, userId);
    if (!conv) throw new Error(`对话不存在: ${conversationId}`);

    const newMessage: Message = {
      id: generateShortId(),
      role: message.role,
      content: message.content,
      timestamp: new Date().toISOString(),
      metadata: message.metadata,
    };

    conv.messages.push(newMessage);
    await this.update(conversationId, userId, { messages: conv.messages });
    return newMessage;
  }

  /**
   * 更新消息（用于流式输出完成后保存完整内容）
   */
  async updateMessage(conversationId: string, userId: string, messageId: string, data: Partial<Message>): Promise<Message | null> {
    const conv = await this.get(conversationId, userId);
    if (!conv) return null;

    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return null;

    conv.messages[idx] = { ...conv.messages[idx], ...data, id: messageId };
    await this.update(conversationId, userId, { messages: conv.messages });
    return conv.messages[idx];
  }

  /**
   * 删除消息
   */
  async deleteMessage(conversationId: string, userId: string, messageId: string): Promise<boolean> {
    const conv = await this.get(conversationId, userId);
    if (!conv) return false;

    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return false;

    conv.messages.splice(idx, 1);
    await this.update(conversationId, userId, { messages: conv.messages });
    return true;
  }

  /**
   * 移除最后一条 AI 消息（用于重新生成）
   */
  async removeLastAssistantMessage(conversationId: string, userId: string): Promise<Message | null> {
    const conv = await this.get(conversationId, userId);
    if (!conv) return null;

    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'assistant') {
        const removed = conv.messages.splice(i, 1)[0];
        await this.update(conversationId, userId, { messages: conv.messages });
        return removed;
      }
    }
    return null;
  }

  /**
   * 检查对话归属
   */
  async checkOwnership(id: string, userId: string): Promise<boolean> {
    const conv = await this.get(id, userId);
    return !!conv;
  }

  /**
   * 更新对话标题
   */
  async updateTitle(id: string, userId: string, title: string): Promise<Conversation> {
    return this.update(id, userId, { title });
  }

  /**
   * 删除某用户的所有对话（级联删除用户时调用）
   */
  async deleteAllByUserId(userId: string): Promise<void> {
    const dir = path.join(storageConfig.dataPath, 'users', userId, 'conversations');
    await fs.remove(dir);
    this.storages.delete(userId);
  }
}

export const conversationService = new ConversationService();
