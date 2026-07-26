import fs from 'fs-extra';
import path from 'path';
import { storageConfig } from '../config/index.js';
import {
  DEFAULT_WORLDBOOK_SETTINGS,
  generateId,
  type Worldbook,
  type WorldbookEntry,
  type WorldbookIndexItem,
} from '../shared/index.js';
import { JSONStorage } from './JSONStorage.js';

/**
 * 世界书存储服务
 * 按用户物理隔离：每个用户的世界书存放在 data/users/{userId}/worldbooks/
 */
export class WorldbookService {
  /** 每个用户一个 JSONStorage 实例 */
  private storages = new Map<string, JSONStorage<Worldbook>>();

  /** 获取（或创建）某用户的存储实例 */
  private getStorage(userId: string): JSONStorage<Worldbook> {
    let s = this.storages.get(userId);
    if (!s) {
      const dir = path.join(storageConfig.dataPath, 'users', userId, 'worldbooks');
      s = new JSONStorage<Worldbook>(dir);
      this.storages.set(userId, s);
    }
    return s;
  }

  /** 供迁移脚本使用 */
  getStorageForMigration(userId: string): JSONStorage<Worldbook> {
    return this.getStorage(userId);
  }

  /**
   * 获取用户的世界书列表
   */
  async getByUserId(userId: string, search?: string): Promise<Worldbook[]> {
    const storage = this.getStorage(userId);
    const items = await storage.query((w) => {
      if (search) {
        const q = search.toLowerCase();
        return w.name.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q);
      }
      return true;
    });
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }

  /**
   * 获取单个世界书
   */
  async get(id: string, userId: string): Promise<Worldbook | null> {
    return this.getStorage(userId).get(id);
  }

  /**
   * 创建世界书
   */
  async createWorldbook(userId: string, data: { name: string; description?: string; settings?: Partial<Worldbook['settings']>; entries?: WorldbookEntry[]; sourceCharacterId?: string }): Promise<Worldbook> {
    if (!data.name) throw new Error('世界书名称不能为空');
    const storage = this.getStorage(userId);
    return storage.create({
      name: data.name,
      description: data.description || '',
      userId,
      ...(data.sourceCharacterId ? { sourceCharacterId: data.sourceCharacterId } : {}),
      settings: {
        ...DEFAULT_WORLDBOOK_SETTINGS,
        ...data.settings,
      },
      entries: data.entries || [],
    } as Omit<Worldbook, 'id' | 'createdAt' | 'updatedAt'>);
  }

  /**
   * 更新世界书
   */
  async update(id: string, userId: string, data: Partial<Worldbook>): Promise<Worldbook> {
    return this.getStorage(userId).update(id, data);
  }

  /**
   * 删除世界书
   */
  async delete(id: string, userId: string): Promise<boolean> {
    return this.getStorage(userId).delete(id);
  }

  /**
   * 检查世界书归属
   */
  async checkOwnership(id: string, userId: string): Promise<boolean> {
    const wb = await this.get(id, userId);
    return !!wb;
  }

  /**
   * 添加条目
   */
  async addEntry(userId: string, worldbookId: string, entry: Partial<WorldbookEntry>): Promise<WorldbookEntry> {
    const wb = await this.get(worldbookId, userId);
    if (!wb) throw new Error(`世界书不存在: ${worldbookId}`);

    // 计算 id（自增）
    const maxId = wb.entries.reduce((max, e) => Math.max(max, e.id || 0), 0);

    const newEntry: WorldbookEntry = {
      uid: generateId('entry'),
      keys: entry.keys || [],
      content: entry.content || '',
      enabled: entry.enabled ?? true,
      insertionOrder: entry.insertionOrder ?? 100,
      caseSensitive: entry.caseSensitive ?? false,
      name: entry.name,
      priority: entry.priority ?? 10,
      id: maxId + 1,
      comment: entry.comment,
      selective: entry.selective ?? false,
      secondaryKeys: entry.secondaryKeys || [],
      constant: entry.constant ?? false,
      position: entry.position || 'before',
      extensions: entry.extensions || {},
    };

    wb.entries.push(newEntry);
    await this.update(worldbookId, userId, { entries: wb.entries });
    return newEntry;
  }

  /**
   * 更新条目
   */
  async updateEntry(userId: string, worldbookId: string, entryUid: string, data: Partial<WorldbookEntry>): Promise<WorldbookEntry> {
    const wb = await this.get(worldbookId, userId);
    if (!wb) throw new Error(`世界书不存在: ${worldbookId}`);

    const idx = wb.entries.findIndex((e) => e.uid === entryUid);
    if (idx < 0) throw new Error(`条目不存在: ${entryUid}`);

    wb.entries[idx] = { ...wb.entries[idx], ...data, uid: entryUid };
    await this.update(worldbookId, userId, { entries: wb.entries });
    return wb.entries[idx];
  }

  /**
   * 删除条目
   */
  async deleteEntry(userId: string, worldbookId: string, entryUid: string): Promise<boolean> {
    const wb = await this.get(worldbookId, userId);
    if (!wb) return false;

    const idx = wb.entries.findIndex((e) => e.uid === entryUid);
    if (idx < 0) return false;

    wb.entries.splice(idx, 1);
    await this.update(worldbookId, userId, { entries: wb.entries });
    return true;
  }

  /**
   * 删除来源于指定角色卡的内嵌世界书（删除角色卡时级联调用）
   */
  async deleteBySourceCharacterId(userId: string, characterId: string): Promise<number> {
    const storage = this.getStorage(userId);
    const bound = await storage.query((w) => w.sourceCharacterId === characterId);
    for (const wb of bound) {
      await storage.delete(wb.id);
    }
    return bound.length;
  }

  /**
   * 删除某用户的所有世界书（级联删除用户时调用）
   */
  async deleteAllByUserId(userId: string): Promise<void> {
    const dir = path.join(storageConfig.dataPath, 'users', userId, 'worldbooks');
    await fs.remove(dir);
    this.storages.delete(userId);
  }
}

export const worldbookService = new WorldbookService();
