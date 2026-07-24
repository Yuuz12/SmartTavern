/**
 * Toast 通知组件 - 基于 mdui.snackbar 封装
 * 保持原有 API 不变：showToast、showSuccess、showError、showInfo
 */
import { snackbar } from '../../lib/mdui/mdui.esm.js';

/**
 * 显示 Toast
 * @param {string} message - 消息内容
 * @param {object} options - 选项 { type, duration }
 */
export function showToast(message, options = {}) {
  const { type = 'info', duration = 3000 } = options;

  try {
    // 使用 mdui 的 snackbar 函数
    const snackbarOpts = {
      message,
      placement: 'top',
      autoCloseDelay: duration,
      closeable: false,
    };

    // 根据类型设置消息样式（不使用 emoji，符合项目规范）
    if (type === 'error') {
      snackbarOpts.message = `<span style="color: rgb(var(--mdui-color-error));">${escapeHtmlSimple(message)}</span>`;
      snackbarOpts.autoCloseDelay = duration || 5000;
    } else {
      snackbarOpts.message = escapeHtmlSimple(message);
    }

    if (typeof snackbar === 'function') {
      return snackbar(snackbarOpts);
    }
  } catch (err) {
    // 回退到原生实现
  }

  // 兜底：原生 Toast 实现
  return fallbackToast(message, options);
}

/**
 * 成功提示
 */
export function showSuccess(message, duration) {
  return showToast(message, { type: 'success', duration });
}

/**
 * 错误提示
 */
export function showError(message, duration) {
  return showToast(message, { type: 'error', duration: duration || 5000 });
}

/**
 * 信息提示
 */
export function showInfo(message, duration) {
  return showToast(message, { type: 'info', duration });
}

// 简单转义
function escapeHtmlSimple(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 兜底实现（mdui 不可用时）
function fallbackToast(message, options = {}) {
  const { type = 'info', duration = 3000 } = options;
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = `padding:12px 20px;border-radius:8px;background:#333;color:#fff;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);pointer-events:auto;`;
  if (type === 'success') toast.style.background = '#4caf50';
  else if (type === 'error') toast.style.background = '#f44336';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
  return toast;
}

export default { showToast, showSuccess, showError, showInfo };
