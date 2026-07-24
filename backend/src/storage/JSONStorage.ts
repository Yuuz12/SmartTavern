import fs from 'fs-extra';
import path from 'path';
import { generateId, logger, type QueryOptions } from '../shared/index.js';

/**
 * 通用 JSON 文件存储类
 * 每个实体类型存储在一个目录下，包含 index.json 索引和 {id}.json 实体文件
 */
export class JSONStorage<T extends { id: string; createdAt: string; updatedAt: string }> {
  protected basePath: string;
  protected indexFile: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.indexFile = path.join(basePath, 'index.json');
  }

  /**
   * 确保目录和索引文件存在
   */
  async ensureDirectory(): Promise<void> {
    await fs.ensureDir(this.basePath);
    if (!await fs.pathExists(this.indexFile)) {
      await this.writeIndex([]);
    }
  }

  /**
   * 读取索引
   */
  async readIndex(): Promise<Array<Record<string, unknown>>> {
    await this.ensureDirectory();
    try {
      const content = await fs.readFile(this.indexFile, 'utf8');
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * 写入索引
   */
  async writeIndex(index: Array<Record<string, unknown>>): Promise<void> {
    await fs.ensureDir(this.basePath);
    await this.atomicWrite(this.indexFile, index);
  }

  /**
   * 原子写入：先写临时文件，再重命名
   */
  protected async atomicWrite(filePath: string, data: unknown): Promise<void> {
    const tmpFile = `${filePath}.tmp`;
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(tmpFile, json, 'utf8');
    await fs.rename(tmpFile, filePath);
  }

  /**
   * 获取实体文件路径
   */
  protected getEntityFile(id: string): string {
    return path.join(this.basePath, `${id}.json`);
  }

  /**
   * 获取索引项（用于列表展示）
   * 子类可重写此方法以提供更丰富的索引信息
   */
  protected buildIndexItem(entity: T): Record<string, unknown> {
    return {
      id: entity.id,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * 获取单个实体
   */
  async get(id: string): Promise<T | null> {
    const file = this.getEntityFile(id);
    try {
      const content = await fs.readFile(file, 'utf8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * 创建实体
   */
  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<T, 'id'>>): Promise<T> {
    const now = new Date().toISOString();
    const entity = {
      ...data,
      id: data.id || generateId(),
      createdAt: now,
      updatedAt: now,
    } as T;

    await this.ensureDirectory();
    const file = this.getEntityFile(entity.id);

    if (await fs.pathExists(file)) {
      throw new Error(`实体已存在: ${entity.id}`);
    }

    await this.atomicWrite(file, entity);

    // 更新索引
    const index = await this.readIndex();
    index.push(this.buildIndexItem(entity));
    await this.writeIndex(index);

    logger.debug('创建实体', { id: entity.id, path: this.basePath });
    return entity;
  }

  /**
   * 更新实体
   */
  async update(id: string, data: Partial<T>): Promise<T> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`实体不存在: ${id}`);
    }

    const updated: T = {
      ...existing,
      ...data,
      id: existing.id, // ID 不可修改
      createdAt: existing.createdAt, // 创建时间不可修改
      updatedAt: new Date().toISOString(),
    };

    await this.atomicWrite(this.getEntityFile(id), updated);

    // 更新索引项
    const index = await this.readIndex();
    const idx = index.findIndex((item) => item.id === id);
    if (idx >= 0) {
      index[idx] = this.buildIndexItem(updated);
      await this.writeIndex(index);
    }

    return updated;
  }

  /**
   * 删除实体
   */
  async delete(id: string): Promise<boolean> {
    const file = this.getEntityFile(id);
    if (!await fs.pathExists(file)) {
      return false;
    }
    await fs.remove(file);

    // 从索引中移除
    const index = await this.readIndex();
    const newIndex = index.filter((item) => item.id !== id);
    await this.writeIndex(newIndex);

    logger.debug('删除实体', { id, path: this.basePath });
    return true;
  }

  /**
   * 查询实体（按条件过滤）
   */
  async query(predicate: (item: T) => boolean): Promise<T[]> {
    const index = await this.readIndex();
    const results: T[] = [];
    for (const item of index) {
      const entity = await this.get(item.id as string);
      if (entity && predicate(entity)) {
        results.push(entity);
      }
    }
    return results;
  }

  /**
   * 获取所有实体（支持分页、排序）
   */
  async getAll(options?: QueryOptions): Promise<{ items: T[]; total: number }> {
    const index = await this.readIndex();

    // 排序
    let sortedIndex = [...index];
    if (options?.sortBy) {
      const sortBy = options.sortBy;
      const sortOrder = options.sortOrder || 'desc';
      sortedIndex.sort((a, b) => {
        const av = String(a[sortBy] ?? '');
        const bv = String(b[sortBy] ?? '');
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return sortOrder === 'asc' ? cmp : -cmp;
      });
    } else {
      // 默认按创建时间倒序
      sortedIndex.sort((a, b) => {
        const av = String(a.createdAt || '');
        const bv = String(b.createdAt || '');
        return bv.localeCompare(av);
      });
    }

    const total = sortedIndex.length;
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 50;
    const start = (page - 1) * pageSize;
    const pageItems = sortedIndex.slice(start, start + pageSize);

    const items: T[] = [];
    for (const item of pageItems) {
      const entity = await this.get(item.id as string);
      if (entity) items.push(entity);
    }

    return { items, total };
  }

  /**
   * 统计总数
   */
  async count(): Promise<number> {
    const index = await this.readIndex();
    return index.length;
  }

  /**
   * 检查实体是否存在
   */
  async exists(id: string): Promise<boolean> {
    return fs.pathExists(this.getEntityFile(id));
  }
}
