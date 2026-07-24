/**
 * 辅助函数
 */

/**
 * 格式化时间为相对时间
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  const diff = now - time;

  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;

  const date = new Date(timestamp);
  const now2 = new Date();
  if (date.getFullYear() === now2.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 格式化时间为 HH:MM
 */
export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 格式化日期
 */
export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 生成简单 ID
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 获取用户名首字母作为头像
 */
export function getInitials(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

/**
 * 截断文本
 */
export function truncate(text, length = 100) {
  if (!text) return '';
  return text.length > length ? text.slice(0, length) + '...' : text;
}

/**
 * 防抖
 */
export function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 转义 HTML
 */
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Markdown 渲染（支持原始 HTML）
 * 支持代码块、行内代码、粗体、斜体、标题、列表、引用、原始 HTML 标签
 * 与 SillyTavern 一致：允许 AI 回复中的 HTML 标签直接渲染
 */
export function renderMarkdown(text) {
  if (!text) return '';

  // 1. 提取代码块（保护内容不被 markdown 处理）
  const codeBlocks = [];
  let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langClass = lang ? ` data-lang="${lang}"` : '';
    codeBlocks.push(`<pre${langClass}><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  // 2. 提取行内代码
  const inlineCodes = [];
  processed = processed.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE_${idx}\x00`;
  });

  // 3. 处理块级元素（按行处理，保留原始 HTML）
  const lines = processed.split('\n');
  const outputLines = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 标题
    if (/^### /.test(line)) { outputLines.push(`<h3>${line.slice(4)}</h3>`); continue; }
    if (/^## /.test(line)) { outputLines.push(`<h2>${line.slice(3)}</h2>`); continue; }
    if (/^# /.test(line)) { outputLines.push(`<h1>${line.slice(2)}</h1>`); continue; }

    // 引用
    if (/^> /.test(line)) { outputLines.push(`<blockquote>${line.slice(2)}</blockquote>`); continue; }

    // 无序列表
    if (/^[\-\*] /.test(line)) {
      if (!inList) { outputLines.push('<ul>'); inList = true; }
      outputLines.push(`<li>${line.slice(2)}</li>`);
      continue;
    }
    if (inList) { outputLines.push('</ul>'); inList = false; }

    // 空行
    if (line.trim() === '') { outputLines.push('<br>'); continue; }

    // 普通行（保留原始 HTML 标签）
    outputLines.push(line);
  }
  if (inList) outputLines.push('</ul>');

  processed = outputLines.join('\n');

  // 4. 行内格式（粗体/斜体）
  processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 5. 恢复行内代码
  processed = processed.replace(/\x00INLINE_(\d+)\x00/g, (_, idx) => inlineCodes[Number(idx)]);

  // 6. 恢复代码块
  processed = processed.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_, idx) => codeBlocks[Number(idx)]);

  return processed;
}

/**
 * 复制到剪贴板
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 下载文件
 */
export function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 读取文件内容
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * 读取文件为 JSON
 */
export async function readFileAsJson(file) {
  const text = await readFileAsText(file);
  return JSON.parse(text);
}
