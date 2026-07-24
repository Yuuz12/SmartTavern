import fs from 'fs-extra';
import path from 'path';
import { storageConfig } from '../config/index.js';
import { logger } from '../shared/index.js';

/**
 * 数据迁移：把旧的全局目录（data/characters、data/worldbooks、data/conversations）
 * 中的实体按 userId 迁移到 data/users/{userId}/{type}/ 下，实现按用户物理隔离。
 *
 * 迁移规则：
 * - 读旧目录的 index.json 获取所有实体 id
 * - 对每个实体读 {id}.json 取 userId 字段
 * - 把实体文件 move 到 data/users/{userId}/{type}/{id}.json
 * - 重建用户目录的 index.json
 * - 旧目录迁移完成后重命名为 .bak（保留备份，不直接删除）
 * - 幂等：若旧目录不存在或已无实体文件则跳过
 */
export async function migrateToUserStorage(): Promise<void> {
  const types: Array<{ name: string; oldDir: string }> = [
    { name: 'characters', oldDir: storageConfig.charactersDir },
    { name: 'worldbooks', oldDir: storageConfig.worldbooksDir },
    { name: 'conversations', oldDir: storageConfig.conversationsDir },
  ];

  for (const { name, oldDir } of types) {
    await migrateOneType(name, oldDir);
  }
}

async function migrateOneType(typeName: string, oldDir: string): Promise<void> {
  // 旧目录不存在或已被改名为 .bak，跳过
  if (!(await fs.pathExists(oldDir))) return;

  // 读取旧 index.json
  const oldIndexFile = path.join(oldDir, 'index.json');
  let indexItems: Array<Record<string, unknown>> = [];
  if (await fs.pathExists(oldIndexFile)) {
    try {
      const content = await fs.readFile(oldIndexFile, 'utf8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) indexItems = data;
    } catch {
      // index 损坏，尝试扫描目录内的 .json 文件
    }
  }

  // 收集所有实体文件（排除 index.json）
  const allFiles = (await fs.readdir(oldDir)).filter(
    (f) => f.endsWith('.json') && f !== 'index.json',
  );

  // 若旧目录没有任何实体文件，且 index 也为空，则删除空目录并跳过
  if (allFiles.length === 0 && indexItems.length === 0) {
    await fs.remove(oldDir);
    logger.info(`迁移跳过：旧目录 ${typeName} 无数据`);
    return;
  }

  // 用 index 中的 id 优先；若 index 为空，则用文件名（去 .json）
  const ids: string[] = indexItems.length > 0
    ? indexItems.map((it) => String(it.id)).filter(Boolean)
    : allFiles.map((f) => f.replace(/\.json$/, ''));

  // 按 userId 分组
  const grouped = new Map<string, Array<{ id: string; entity: Record<string, unknown> }>>();
  let migratedCount = 0;

  for (const id of ids) {
    const entityFile = path.join(oldDir, `${id}.json`);
    if (!(await fs.pathExists(entityFile))) continue;

    let entity: Record<string, unknown>;
    try {
      entity = JSON.parse(await fs.readFile(entityFile, 'utf8'));
    } catch {
      logger.warn(`迁移跳过：无法解析 ${typeName}/${id}.json`);
      continue;
    }

    const userId = entity.userId as string | undefined;
    if (!userId) {
      logger.warn(`迁移跳过：${typeName}/${id}.json 缺少 userId 字段`);
      continue;
    }

    // 幂等：目标已存在则跳过移动（但仍记录以便重建索引）
    const targetDir = path.join(storageConfig.dataPath, 'users', userId, typeName);
    const targetFile = path.join(targetDir, `${id}.json`);
    await fs.ensureDir(targetDir);
    if (!(await fs.pathExists(targetFile))) {
      await fs.move(entityFile, targetFile, { overwrite: false });
    } else {
      // 目标已存在，删除旧文件
      await fs.remove(entityFile);
    }

    if (!grouped.has(userId)) grouped.set(userId, []);
    grouped.get(userId)!.push({ id, entity });
    migratedCount++;
  }

  // 为每个用户目录重建 index.json（合并已有索引）
  for (const [userId, items] of grouped) {
    const userDir = path.join(storageConfig.dataPath, 'users', userId, typeName);
    const userIndexFile = path.join(userDir, 'index.json');

    // 读取已有的索引项（若存在）
    let existingIndex: Array<Record<string, unknown>> = [];
    if (await fs.pathExists(userIndexFile)) {
      try {
        const content = await fs.readFile(userIndexFile, 'utf8');
        const data = JSON.parse(content);
        if (Array.isArray(data)) existingIndex = data;
      } catch {
        // 忽略
      }
    }

    // 合并：以已有索引为基础，补充新迁入的项（去重）
    const existingIds = new Set(existingIndex.map((it) => String(it.id)));
    const newIndexItems = [...existingIndex];
    for (const { id, entity } of items) {
      if (existingIds.has(id)) continue;
      // 用旧 index 项（若有），否则用实体的最小信息
      const oldIndexItem = indexItems.find((it) => String(it.id) === id);
      if (oldIndexItem) {
        newIndexItems.push(oldIndexItem);
      } else {
        newIndexItems.push({
          id: entity.id,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        });
      }
    }

    await fs.writeFile(userIndexFile, JSON.stringify(newIndexItems, null, 2), 'utf8');
  }

  // 旧目录改名为 .bak（保留备份）
  const bakDir = `${oldDir}.bak`;
  // 若 .bak 已存在，先删除（避免冲突）
  if (await fs.pathExists(bakDir)) {
    await fs.remove(bakDir);
  }
  // 此时旧目录应只剩 index.json（实体已移走），整体改名为 .bak
  if (await fs.pathExists(oldDir)) {
    await fs.rename(oldDir, bakDir);
  }

  logger.info(`迁移完成：${typeName} 共迁移 ${migratedCount} 个实体，旧目录备份为 ${path.basename(bakDir)}`);
}
