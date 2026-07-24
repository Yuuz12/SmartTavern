import type { RegexScript } from '../types/index.js';

export interface RegexContext {
  /** 消息深度（0=最后一条） */
  depth?: number;
  /** 当前角色 ID */
  characterId?: string;
  /** 作用目标过滤 */
  target: 'display' | 'userInput' | 'prompt';
}

/**
 * 解析 /pattern/flags 格式的正则表达式字符串
 * 如果不包含斜杠包裹，则视为纯 pattern（默认无 flags）
 */
export function parseRegexString(input: string): RegExp | null {
  if (!input || !input.trim()) return null;
  const trimmed = input.trim();

  // 尝试匹配 /pattern/flags 格式
  const slashMatch = trimmed.match(/^\/(.+)\/([dgimsuvy]*)$/s);
  if (slashMatch) {
    try {
      return new RegExp(slashMatch[1], slashMatch[2]);
    } catch {
      return null;
    }
  }

  // 纯 pattern，无 flags
  try {
    return new RegExp(trimmed);
  } catch {
    return null;
  }
}

/**
 * 对单个文本应用单个正则脚本
 */
export function applySingleRegex(text: string, script: RegexScript): string {
  const regex = parseRegexString(script.findRegex);
  if (!regex) return text;

  return text.replace(regex, (match, ...args) => {
    // args: p1, p2, ..., offset, string, groups
    const groups: string[] = [];
    for (let i = 0; i < args.length - 2; i++) {
      groups.push(args[i] ?? '');
    }

    let replacement = script.replaceWith;

    // 处理 trimOut：从 match 中移除指定内容后再替换
    let processedMatch = match;
    if (script.trimOut) {
      const trims = script.trimOut.split('\n').filter((t) => t.length > 0);
      for (const trim of trims) {
        processedMatch = processedMatch.split(trim).join('');
      }
    }

    // 替换 {{match}} 为处理后的匹配文本
    replacement = replacement.replace(/\{\{match\}\}/g, processedMatch);

    // 替换 $1-$9 捕获组
    replacement = replacement.replace(/\$(\d)/g, (_, num) => {
      const idx = parseInt(num, 10) - 1;
      return idx < groups.length ? groups[idx] : '';
    });

    return replacement;
  });
}

/**
 * 过滤出适用于当前上下文的正则脚本（按 order 排序）
 */
export function filterRegexScripts(
  scripts: RegexScript[],
  context: RegexContext,
): RegexScript[] {
  return scripts
    .filter((s) => s.enabled)
    .filter((s) => s.affects[context.target])
    .filter((s) => {
      // 角色匹配
      if (s.scope !== 'global' && context.characterId && s.scope !== context.characterId) {
        return false;
      }
      return true;
    })
    .filter((s) => {
      // 深度过滤（仅 prompt 目标使用深度）
      if (context.target === 'prompt' && context.depth !== undefined) {
        const minD = s.minDepth ?? -1;
        const maxD = s.maxDepth ?? -1;
        if (minD >= 0 && context.depth < minD) return false;
        if (maxD >= 0 && context.depth > maxD) return false;
      }
      return true;
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * 对文本应用所有匹配的正则脚本
 */
export function applyRegexScripts(
  text: string,
  scripts: RegexScript[],
  context: RegexContext,
): string {
  if (!scripts || scripts.length === 0) return text;

  const applicable = filterRegexScripts(scripts, context);
  let result = text;
  for (const script of applicable) {
    result = applySingleRegex(result, script);
  }
  return result;
}
