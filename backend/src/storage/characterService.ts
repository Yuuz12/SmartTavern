import fs from 'fs-extra';
import path from 'path';
import { storageConfig } from '../config/index.js';
import { logger, type Character, type CharacterIndexItem, type WorldbookEntry } from '../shared/index.js';
import { JSONStorage } from './JSONStorage.js';
import { worldbookService } from './worldbookService.js';

/**
 * 角色卡存储服务
 * 按用户物理隔离：每个用户的角色卡存放在 data/users/{userId}/characters/
 */
export class CharacterService {
  /** 每个用户一个 JSONStorage 实例 */
  private storages = new Map<string, JSONStorage<Character>>();

  /** 获取（或创建）某用户的存储实例 */
  private getStorage(userId: string): JSONStorage<Character> {
    let s = this.storages.get(userId);
    if (!s) {
      const dir = path.join(storageConfig.dataPath, 'users', userId, 'characters');
      s = new JSONStorage<Character>(dir);
      this.storages.set(userId, s);
    }
    return s;
  }

  /** 供迁移脚本使用：直接操作指定用户目录 */
  getStorageForMigration(userId: string): JSONStorage<Character> {
    return this.getStorage(userId);
  }

  /**
   * 获取用户的角色卡列表
   */
  async getByUserId(userId: string, options?: { search?: string; tag?: string }): Promise<Character[]> {
    const storage = this.getStorage(userId);
    const items = await storage.query((c) => {
      if (options?.search) {
        const q = options.search.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !(c.description || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      if (options?.tag && !(c.tags || []).includes(options.tag)) {
        return false;
      }
      return true;
    });
    // 按更新时间倒序
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }

  /**
   * 获取单个角色卡
   */
  async get(id: string, userId: string): Promise<Character | null> {
    return this.getStorage(userId).get(id);
  }

  /**
   * 创建角色卡
   */
  async createCharacter(userId: string, data: Partial<Omit<Character, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Promise<Character> {
    if (!data.name) throw new Error('角色卡名称不能为空');
    const storage = this.getStorage(userId);
    return storage.create({
      ...data,
      name: data.name,
      userId,
      tags: data.tags || [],
      alternateGreetings: data.alternateGreetings || [],
      worldBookIds: data.worldBookIds || [],
      extensions: data.extensions || {},
    } as Omit<Character, 'id' | 'createdAt' | 'updatedAt'>);
  }

  /**
   * 更新角色卡
   */
  async updateCharacter(id: string, userId: string, data: Partial<Character>): Promise<Character> {
    return this.getStorage(userId).update(id, data);
  }

  /**
   * 删除角色卡
   */
  async delete(id: string, userId: string): Promise<boolean> {
    return this.getStorage(userId).delete(id);
  }

  /**
   * 检查角色卡归属
   */
  async checkOwnership(id: string, userId: string): Promise<boolean> {
    const char = await this.get(id, userId);
    return !!char;
  }

  /**
   * 获取角色卡名称映射（用于对话列表显示）
   */
  async getCharacterNames(userId: string): Promise<Map<string, string>> {
    const chars = await this.getByUserId(userId);
    return new Map(chars.map((c) => [c.id, c.name]));
  }

  /**
   * 将 SillyTavern character_book 条目转换为后端 WorldbookEntry 格式
   * character_book 条目格式与 SillyTavern 世界书条目格式相同
   */
  private normalizeCharacterBookEntries(rawEntries: unknown): WorldbookEntry[] {
    if (!rawEntries) return [];

    // character_book.entries 通常是对象（字典）
    const entryList: Record<string, unknown>[] = Array.isArray(rawEntries)
      ? (rawEntries as Record<string, unknown>[])
      : Object.values(rawEntries as Record<string, Record<string, unknown>>);

    return entryList.map((entry, index) => {
      let position: 'before' | 'after' = 'before';
      if (typeof entry.position === 'number') {
        position = entry.position === 1 ? 'after' : 'before';
      } else if (entry.position === 'before' || entry.position === 'after') {
        position = entry.position as 'before' | 'after';
      }

      const uid = entry.uid != null ? String(entry.uid) : `entry_${index}`;

      const enabled: boolean =
        typeof entry.disable === 'boolean'
          ? !entry.disable
          : typeof entry.enabled === 'boolean'
            ? entry.enabled
            : true;

      const keys = Array.isArray(entry.keys)
        ? (entry.keys as string[])
        : Array.isArray(entry.key)
          ? (entry.key as string[])
          : [];

      const secondaryKeys = Array.isArray(entry.secondaryKeys)
        ? (entry.secondaryKeys as string[])
        : Array.isArray(entry.keysecondary)
          ? (entry.keysecondary as string[])
          : [];

      const normalized: WorldbookEntry = {
        uid,
        keys,
        secondaryKeys,
        content: typeof entry.content === 'string' ? entry.content : '',
        comment: typeof entry.comment === 'string' ? entry.comment : undefined,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        enabled,
        insertionOrder:
          typeof entry.insertionOrder === 'number'
            ? entry.insertionOrder
            : typeof entry.order === 'number'
              ? entry.order
              : 100,
        caseSensitive: typeof entry.caseSensitive === 'boolean' ? entry.caseSensitive : false,
        priority: typeof entry.priority === 'number' ? entry.priority : 10,
        id: index + 1,
        selective: typeof entry.selective === 'boolean' ? entry.selective : false,
        constant: typeof entry.constant === 'boolean' ? entry.constant : false,
        position,
        extensions:
          entry.extensions && typeof entry.extensions === 'object'
            ? (entry.extensions as Record<string, unknown>)
            : {},
      };
      return normalized;
    });
  }

  /**
   * 导入角色卡（支持 SillyTavern v1/v2 格式）
   * 若角色卡内嵌 character_book（角色世界书），自动提取并创建世界书绑定到角色
   */
  async importCharacter(userId: string, rawData: Record<string, unknown>): Promise<Character> {
    // 适配 v2 格式（data 字段）
    const data = (rawData.data as Record<string, unknown>) || rawData;

    const characterName = String(data.name || '未命名角色');

    // 提取角色世界书（character_book）
    let worldBookIds: string[] = [];
    const characterBook = data.character_book as Record<string, unknown> | undefined;
    if (characterBook && typeof characterBook === 'object') {
      try {
        const entries = this.normalizeCharacterBookEntries(characterBook.entries);
        if (entries.length > 0) {
          const wb = await worldbookService.createWorldbook(userId, {
            name: `${characterName} 的角色世界书`,
            description: '从角色卡导入的内嵌世界书',
            entries,
          });
          worldBookIds.push(wb.id);
          logger.info('角色世界书已提取', {
            characterName,
            worldbookId: wb.id,
            entryCount: entries.length,
          });
        }
      } catch (err) {
        logger.error('角色世界书提取失败', { error: (err as Error).message });
      }
    }

    return this.createCharacter(userId, {
      name: characterName,
      avatar: data.avatar as string | undefined,
      description: data.description as string | undefined,
      personality: data.personality as string | undefined,
      scenario: data.scenario as string | undefined,
      mesExample: (data.mes_example || data.mesExample) as string | undefined,
      firstMes: (data.first_mes || data.firstMes) as string | undefined,
      systemPrompt: (data.system_prompt || data.systemPrompt) as string | undefined,
      postHistoryInstructions: (data.post_history_instructions || data.postHistoryInstructions) as string | undefined,
      alternateGreetings: data.alternate_greetings as string[] | undefined,
      creator: data.creator as string | undefined,
      characterVersion: (data.character_version || data.characterVersion) as string | undefined,
      tags: data.tags as string[] | undefined,
      spec: rawData.spec as string | undefined,
      specVersion: (rawData.spec_version || rawData.specVersion) as string | undefined,
      worldBookIds,
      extensions: data.extensions as Record<string, unknown> | undefined,
    });
  }

  /**
   * 导出角色卡（SillyTavern v2 格式）
   */
  async exportCharacter(id: string, userId: string): Promise<Record<string, unknown>> {
    const char = await this.get(id, userId);
    if (!char) throw new Error(`角色卡不存在: ${id}`);

    return {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: char.name,
        description: char.description || '',
        personality: char.personality || '',
        scenario: char.scenario || '',
        first_mes: char.firstMes || '',
        mes_example: char.mesExample || '',
        creator_notes: '',
        system_prompt: char.systemPrompt || '',
        post_history_instructions: char.postHistoryInstructions || '',
        alternate_greetings: char.alternateGreetings || [],
        tags: char.tags || [],
        creator: char.creator || '',
        character_version: char.characterVersion || '',
        extensions: char.extensions || {},
      },
    };
  }

  /**
   * 删除某用户的所有角色卡（级联删除用户时调用）
   */
  async deleteAllByUserId(userId: string): Promise<void> {
    // 直接删除用户角色卡目录，并清理缓存
    const dir = path.join(storageConfig.dataPath, 'users', userId, 'characters');
    await fs.remove(dir);
    this.storages.delete(userId);
  }
}

export const characterService = new CharacterService();
