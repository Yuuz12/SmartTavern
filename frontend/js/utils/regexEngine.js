/**
 * 前端正则引擎
 * 与后端 regex.ts 逻辑一致，用于显示替换和用户输入替换
 */

/**
 * 解析 /pattern/flags 格式的正则表达式字符串
 */
export function parseRegexString(input) {
  if (!input || !input.trim()) return null;
  const trimmed = input.trim();

  const slashMatch = trimmed.match(/^\/(.+)\/([dgimsuvy]*)$/s);
  if (slashMatch) {
    try {
      return new RegExp(slashMatch[1], slashMatch[2]);
    } catch {
      return null;
    }
  }

  try {
    return new RegExp(trimmed);
  } catch {
    return null;
  }
}

/**
 * 对单个文本应用单个正则脚本
 */
export function applySingleRegex(text, script) {
  const regex = parseRegexString(script.findRegex);
  if (!regex) return text;

  return text.replace(regex, (match, ...args) => {
    const groups = [];
    for (let i = 0; i < args.length - 2; i++) {
      groups.push(args[i] ?? '');
    }

    let replacement = script.replaceWith;

    // 处理 trimOut
    let processedMatch = match;
    if (script.trimOut) {
      const trims = script.trimOut.split('\n').filter((t) => t.length > 0);
      for (const trim of trims) {
        processedMatch = processedMatch.split(trim).join('');
      }
    }

    // 替换 {{match}}
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
 * @param {Array} scripts - 正则脚本列表
 * @param {Object} context - { target: 'display'|'userInput', depth?, characterId? }
 */
export function filterRegexScripts(scripts, context) {
  return scripts
    .filter((s) => s.enabled)
    .filter((s) => s.affects && s.affects[context.target])
    .filter((s) => {
      if (s.scope !== 'global' && context.characterId && s.scope !== context.characterId) {
        return false;
      }
      return true;
    })
    .filter((s) => {
      if (context.depth !== undefined) {
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
 * @param {string} text - 输入文本
 * @param {Array} scripts - 正则脚本列表
 * @param {Object} context - { target, depth?, characterId? }
 * @returns {string} 替换后的文本
 */
export function applyRegexScripts(text, scripts, context) {
  if (!scripts || scripts.length === 0) return text;

  const applicable = filterRegexScripts(scripts, context);
  let result = text;
  for (const script of applicable) {
    result = applySingleRegex(result, script);
  }
  return result;
}
