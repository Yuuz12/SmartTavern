/**
 * 模态框组件 - 基于 mdui-dialog 封装
 * 保持原有 API 不变：showModal、confirm、prompt
 */
import { escapeHtml } from '../utils/helpers.js';

/**
 * 显示模态框
 * @param {object} options - { title, content, actions, onMount, closeOnOverlay }
 * @returns {Promise} 返回用户选择的 action 值
 */
export function showModal(options = {}) {
  const {
    title = '',
    content = '',
    actions = [{ text: '确定', value: 'ok', type: 'filled' }],
    onMount,
    closeOnOverlay = true,
  } = options;

  return new Promise((resolve) => {
    // 创建 mdui-dialog 元素
    const dialog = document.createElement('mdui-dialog');
    if (title) dialog.setAttribute('headline', title);
    dialog.setAttribute('close-on-esc', '');
    // 不使用 close-on-overlay-click，改为手动处理 overlay-click，
    // 以过滤 mdui-select 下拉收起时的误触发

    // 主体内容（使用 innerHTML 直接放入 body slot）
    dialog.innerHTML = `<div class="modal-body">${content}</div>`;

    // 操作按钮放入 action slot
    const actionsHtml = actions
      .map((a) => {
        const variant = a.type === 'filled' ? 'filled' : a.type === 'outlined' ? 'outlined' : 'text';
        return `<mdui-button slot="action" variant="${variant}" data-action="${a.value}">${escapeHtml(a.text)}</mdui-button>`;
      })
      .join('');
    dialog.insertAdjacentHTML('beforeend', actionsHtml);

    document.body.appendChild(dialog);

    // 打开对话框
    requestAnimationFrame(() => {
      dialog.open = true;
    });

    // 关闭函数
    const close = (value) => {
      dialog.open = false;
      setTimeout(() => {
        dialog.remove();
        resolve(value);
      }, 200);
    };

    // 事件绑定
    dialog.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => close(btn.dataset.action));
    });

    // overlay-click 关闭（手动处理，过滤 mdui-select 下拉收起的误触发）
    let suppressOverlayClose = false;
    dialog.addEventListener('pointerdown', (e) => {
      suppressOverlayClose = e.composedPath().some((el) => el.tagName === 'MDUI-SELECT');
    });
    dialog.addEventListener('overlay-click', () => {
      if (suppressOverlayClose) {
        suppressOverlayClose = false;
        return;
      }
      if (closeOnOverlay) close(null);
    });
    dialog.addEventListener('closed', (e) => {
      // mdui 组件的 closed 事件（composed:true, bubbles:true）会冒泡到 dialog，
      // 需过滤掉来自子组件（如 mdui-select 内部的 mdui-dropdown）的 closed 事件
      if (e.target !== dialog) return;
      // 如果还没 resolve，则 resolve 为 null
      if (document.body.contains(dialog)) {
        close(null);
      }
    });

    // 自定义挂载回调
    if (onMount) {
      // 等待对话框渲染完成
      requestAnimationFrame(() => onMount(dialog, close));
    }
  });
}

/**
 * 确认对话框
 */
export function confirm(message, title = '确认操作') {
  return showModal({
    title,
    content: `<p style="margin: 0; font-size: 14px; line-height: 1.6;">${escapeHtml(message)}</p>`,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '确定', value: 'ok', type: 'filled' },
    ],
  }).then((v) => v === 'ok');
}

/**
 * 输入对话框
 */
export function prompt(message, defaultValue = '', title = '输入') {
  return showModal({
    title,
    content: `
      <p style="margin: 0 0 12px; font-size: 14px;">${escapeHtml(message)}</p>
      <mdui-text-field id="prompt-input" variant="outlined" value="${escapeHtml(defaultValue)}" style="width: 100%;"></mdui-text-field>
    `,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '确定', value: 'ok', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      const input = dialog.querySelector('#prompt-input');
      requestAnimationFrame(() => {
        input?.focus();
        // 选中文字
        const inputEl = input?.shadowRoot?.querySelector('input');
        if (inputEl) inputEl.select();
      });
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          close(input.value);
        }
      });
      dialog.querySelector('[data-action="ok"]').addEventListener('click', () => {
        close(input.value);
      });
    },
  });
}

export default { showModal, confirm, prompt };
