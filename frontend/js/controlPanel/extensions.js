/**
 * 模块 6: 扩展
 * 为 AI 或界面添加新功能和能力
 */
import { showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml } from '../utils/helpers.js';
import storage from '../utils/storage.js';

const EXTENSIONS_KEY = 'cp_extensions';
const EXTENSION_SETTINGS_KEY = 'cp_extension_settings';

// 内置扩展列表（参考 SillyTavern 的核心扩展）
const BUILTIN_EXTENSIONS = [
  {
    id: 'caption',
    name: 'Image Captioning',
    description: '为图片生成描述文字，支持多模态模型',
    author: 'SmartTavern',
    version: '1.0.0',
    enabled: false,
    icon: 'image',
    category: 'multimodal',
  },
  {
    id: 'expressions',
    name: 'Character Expressions',
    description: '根据对话内容动态切换角色表情',
    author: 'SmartTavern',
    version: '1.0.0',
    enabled: false,
    icon: 'face',
    category: 'visual',
  },
  {
    id: 'tts',
    name: 'Text-to-Speech',
    description: '将 AI 回复转换为语音',
    author: 'SmartTavern',
    version: '1.0.0',
    enabled: false,
    icon: 'volume',
    category: 'audio',
  },
  {
    id: 'sd',
    name: 'Stable Diffusion',
    description: '生成图片并插入到对话中',
    author: 'SmartTavern',
    version: '1.0.0',
    enabled: false,
    icon: 'image',
    category: 'image-gen',
  },
  {
    id: 'vectorize',
    name: 'Vector Storage',
    description: '向量化文档和对话，支持语义检索',
    author: 'SmartTavern',
    version: '1.0.0',
    enabled: false,
    icon: 'search',
    category: 'retrieval',
  },
  {
    id: 'translate',
    name: 'Translation',
    description: '自动翻译对话内容',
    author: 'SmartTavern',
    version: '1.0.0',
    enabled: false,
    icon: 'translate',
    category: 'text',
  },
  {
    id: 'quick-reply',
    name: 'Quick Reply',
    description: '快速回复按钮，预设常用消息',
    author: 'SmartTavern',
    version: '1.0.0',
    enabled: false,
    icon: 'send',
    category: 'ui',
  },
];

const ICON_PATHS = {
  image: '<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>',
  volume: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>',
  translate: '<path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>',
};

function loadExtensions() {
  const stored = storage.get(EXTENSIONS_KEY, {});
  // 合并内置扩展和已存储的启用状态
  return BUILTIN_EXTENSIONS.map((ext) => ({
    ...ext,
    enabled: stored[ext.id] !== undefined ? stored[ext.id] : ext.enabled,
  }));
}

function saveExtensionState(id, enabled) {
  const stored = storage.get(EXTENSIONS_KEY, {});
  stored[id] = enabled;
  storage.set(EXTENSIONS_KEY, stored);
}

function loadExtensionSettings() {
  return storage.get(EXTENSION_SETTINGS_KEY, {});
}

function saveExtensionSettings(settings) {
  storage.set(EXTENSION_SETTINGS_KEY, settings);
}

/**
 * 渲染扩展模块
 */
export function renderExtensions(container, opts = {}) {
  const extensions = loadExtensions();
  const settings = loadExtensionSettings();

  container.innerHTML = `
    <div class="cp-toolbar">
      <span class="cp-toolbar__title">扩展管理</span>
      <mdui-button variant="outlined" id="cp-ext-install" icon="upload">安装扩展</mdui-button>
      <mdui-button-icon icon="refresh" id="cp-ext-refresh" label="刷新"></mdui-button-icon>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('cubes', 18)}</span>
        内置扩展
      </h3>
      <div id="cp-ext-list"></div>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('settings', 18)}</span>
        扩展全局设置
      </h3>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">更新通知</div>
          <div class="cp-switch-row__desc">有扩展更新时显示通知</div>
        </div>
        <mdui-switch id="ext-notify" ${settings.notifyUpdates !== false ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">自动连接</div>
          <div class="cp-switch-row__desc">自动连接到扩展服务器</div>
        </div>
        <mdui-switch id="ext-auto-connect" ${settings.autoConnect ? 'checked' : ''}></mdui-switch>
      </div>
    </div>
  `;

  renderExtensionList(container.querySelector('#cp-ext-list'), extensions);

  container.querySelector('#cp-ext-install')?.addEventListener('click', () => {
    showInstallForm(() => renderExtensions(container, { force: true }));
  });

  container.querySelector('#cp-ext-refresh')?.addEventListener('click', () => {
    showInfo('已刷新扩展列表');
    renderExtensions(container, { force: true });
  });

  container.querySelector('#ext-notify')?.addEventListener('change', (e) => {
    settings.notifyUpdates = e.target.checked;
    saveExtensionSettings(settings);
  });

  container.querySelector('#ext-auto-connect')?.addEventListener('change', (e) => {
    settings.autoConnect = e.target.checked;
    saveExtensionSettings(settings);
  });
}

function renderExtensionList(container, extensions) {
  if (!extensions || extensions.length === 0) {
    container.innerHTML = '<div class="cp-empty"><div class="cp-empty__title">没有可用的扩展</div></div>';
    return;
  }

  // 按类别分组
  const categories = {};
  extensions.forEach((ext) => {
    const cat = ext.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(ext);
  });

  const categoryNames = {
    'multimodal': '多模态',
    'visual': '视觉',
    'audio': '音频',
    'image-gen': '图片生成',
    'text': '文本处理',
    'retrieval': '检索',
    'ui': '界面',
    'other': '其他',
  };

  container.innerHTML = Object.entries(categories).map(([cat, exts]) => `
    <div style="margin-bottom: var(--md-sys-spacing-3);">
      <div style="font-size: 12px; color: var(--md-sys-color-on-surface-variant); margin-bottom: var(--md-sys-spacing-2); text-transform: uppercase; letter-spacing: 0.5px;">${categoryNames[cat] || cat}</div>
      ${exts.map((ext) => renderExtensionItem(ext)).join('')}
    </div>
  `).join('');

  container.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const ext = extensions.find((e) => e.id === id);
      if (!ext) return;
      ext.enabled = !ext.enabled;
      saveExtensionState(id, ext.enabled);
      btn.textContent = ext.enabled ? '禁用' : '启用';
      btn.style.color = ext.enabled ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)';
      btn.closest('.cp-extension-item').classList.toggle('cp-extension-item--enabled', ext.enabled);
      if (ext.enabled) {
        showSuccess(`已启用扩展“${ext.name}”`);
      } else {
        showInfo(`已禁用扩展“${ext.name}”`);
      }
      // 快速回复扩展启用/禁用时通知聊天页面刷新
      if (id === 'quick-reply') {
        document.dispatchEvent(new CustomEvent('quick-reply-updated'));
      }
    });
  });

  container.querySelectorAll('[data-action="settings"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const ext = extensions.find((e) => e.id === id);
      if (ext) showExtensionSettings(ext);
    });
  });
}

function renderExtensionItem(ext) {
  const iconSvg = ICON_PATHS[ext.icon]
    ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">${ICON_PATHS[ext.icon]}</svg>`
    : getIcon('cube', 20);
  return `
    <mdui-card class="cp-extension-item ${ext.enabled ? 'cp-extension-item--enabled' : ''}" variant="outlined" clickable>
      <div class="cp-extension-item__icon">${iconSvg}</div>
      <div class="cp-extension-item__body">
        <div class="cp-extension-item__name">${escapeHtml(ext.name)}</div>
        <div class="cp-extension-item__desc">${escapeHtml(ext.description)}</div>
        <div class="cp-extension-item__meta">
          <span>v${ext.version}</span>
          <span>·</span>
          <span>${escapeHtml(ext.author)}</span>
          ${ext.enabled ? '<span class="cp-badge cp-badge--success"><span class="cp-badge__dot"></span>已启用</span>' : '<span class="cp-badge">未启用</span>'}
        </div>
      </div>
      <div class="cp-extension-item__actions">
        <mdui-button variant="outlined" data-action="toggle" data-id="${ext.id}" style="color: ${ext.enabled ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)'};">
          ${ext.enabled ? '禁用' : '启用'}
        </mdui-button>
        <mdui-button-icon icon="settings" data-action="settings" data-id="${ext.id}" label="设置"></mdui-button-icon>
      </div>
    </mdui-card>
  `;
}

function showInstallForm(callback) {
  showModal({
    title: '安装扩展',
    content: `
      <div class="mgmt-form">
        <div class="form-group">
          <mdui-text-field id="ext-url" label="Git 仓库 URL" variant="outlined" placeholder="https://github.com/user/extension.git"></mdui-text-field>
          <div class="cp-field__hint" style="margin-top: 4px;">
            支持第三方 Git 仓库。安装的扩展将下载到本地。
          </div>
        </div>
        <div class="form-group">
          <label class="form-group__label">或从本地文件导入</label>
          <input type="file" id="ext-file" accept=".zip" style="width: 100%;" />
        </div>
        <div style="padding: var(--md-sys-spacing-2); background-color: var(--md-sys-color-error-container); border-radius: var(--md-sys-shape-corner-medium); margin-top: var(--md-sys-spacing-2);">
          <div style="font-size: 12px; color: var(--md-sys-color-on-error-container);">
            <strong>警告：</strong>第三方扩展可能包含恶意代码。仅安装来自可信来源的扩展。
          </div>
        </div>
      </div>
    `,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '安装', value: 'install', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="install"]').addEventListener('click', () => {
        const url = dialog.querySelector('#ext-url').value.trim();
        const file = dialog.querySelector('#ext-file').files?.[0];
        if (!url && !file) {
          showError('请提供 Git URL 或选择文件');
          return;
        }
        // 模拟安装过程（实际需要后端支持）
        showInfo('正在安装扩展...');
        setTimeout(() => {
          showSuccess('扩展安装功能正在开发中（当前为演示模式）');
          close('installed');
        }, 1000);
      });
    },
  });
}

function showExtensionSettings(ext) {
  const settings = loadExtensionSettings();
  const extSettings = settings[ext.id] || {};

  let content = `
    <div class="mgmt-form">
      <div style="margin-bottom: var(--md-sys-spacing-3);">
        <strong>${escapeHtml(ext.name)}</strong>
        <span style="color: var(--md-sys-color-on-surface-variant); margin-left: 8px;">v${ext.version}</span>
      </div>
  `;

  // 根据扩展类型显示不同的设置
  if (ext.id === 'caption') {
    content += `
      <div class="form-group">
        <mdui-text-field id="ext-caption-prompt" label="图片描述提示词" variant="outlined" rows="3" autosize max-rows="10" value="${escapeHtml(extSettings.prompt || 'Describe this image in detail.')}"></mdui-text-field>
      </div>
      <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
        <mdui-switch id="ext-caption-refine" ${extSettings.refineMode ? 'checked' : ''}></mdui-switch>
        <span style="font-size: 14px;">精细模式</span>
      </label>
    `;
  } else if (ext.id === 'tts') {
    content += `
      <div class="form-group">
        <mdui-select id="ext-tts-provider" label="TTS 服务" variant="outlined" value="${extSettings.provider || 'browser'}">
          <mdui-menu-item value="browser">浏览器内置</mdui-menu-item>
          <mdui-menu-item value="edge">Edge TTS</mdui-menu-item>
          <mdui-menu-item value="elevenlabs">ElevenLabs</mdui-menu-item>
        </mdui-select>
      </div>
      <div class="form-group">
        <mdui-text-field id="ext-tts-voice" label="语音" variant="outlined" value="${escapeHtml(extSettings.voice || 'zh-CN-XiaoxiaoNeural')}"></mdui-text-field>
      </div>
    `;
  } else if (ext.id === 'sd') {
    content += `
      <div class="form-group">
        <mdui-text-field id="ext-sd-url" label="Stable Diffusion URL" variant="outlined" value="${escapeHtml(extSettings.url || 'http://127.0.0.1:7860')}"></mdui-text-field>
      </div>
      <div class="mgmt-form__row">
        <div class="form-group">
          <mdui-text-field id="ext-sd-prompt" label="默认提示词" variant="outlined" value="${escapeHtml(extSettings.prompt || 'masterpiece, best quality')}"></mdui-text-field>
        </div>
        <div class="form-group">
          <mdui-text-field id="ext-sd-negative" label="负面提示词" variant="outlined" value="${escapeHtml(extSettings.negative || 'lowres, bad anatomy')}"></mdui-text-field>
        </div>
      </div>
    `;
  } else if (ext.id === 'quick-reply') {
    const replies = extSettings.replies || [];
    content += `
      <div class="form-group">
        <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer; margin-bottom: var(--md-sys-spacing-2);">
          <mdui-switch id="ext-quick-reply-autoSend" ${extSettings.autoSend ? 'checked' : ''}></mdui-switch>
          <span style="font-size: 14px;">点击后自动发送（关闭则仅填入输入框）</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-group__label">快捷回复列表</label>
        <div id="ext-qr-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;">
          ${replies.map((r, i) => `
            <div class="ext-qr-item" data-idx="${i}" style="display:flex;gap:8px;align-items:center;">
              <mdui-text-field class="ext-qr-label" variant="outlined" placeholder="按钮文字" value="${escapeHtml(r.label || '')}" style="flex:1;"></mdui-text-field>
              <mdui-text-field class="ext-qr-msg" variant="outlined" placeholder="发送内容" value="${escapeHtml(r.message || '')}" style="flex:2;"></mdui-text-field>
              <mdui-button-icon icon="close" class="ext-qr-del" label="删除"></mdui-button-icon>
            </div>
          `).join('')}
        </div>
        <mdui-button variant="outlined" id="ext-qr-add" icon="add">添加快捷回复</mdui-button>
      </div>
    `;
  } else {
    content += `
      <div class="cp-empty">
        <div class="cp-empty__title">暂无可配置项</div>
        <div class="cp-empty__desc">此扩展没有可配置的设置</div>
      </div>
    `;
  }

  content += `</div>`;

  showModal({
    title: `${ext.name} 设置`,
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '保存', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      // Quick Reply 动态增删
      if (ext.id === 'quick-reply') {
        dialog.querySelector('#ext-qr-add')?.addEventListener('click', () => {
          const list = dialog.querySelector('#ext-qr-list');
          const div = document.createElement('div');
          div.className = 'ext-qr-item';
          div.style.cssText = 'display:flex;gap:8px;align-items:center;';
          div.innerHTML = '<mdui-text-field class="ext-qr-label" variant="outlined" placeholder="按钮文字" style="flex:1;"></mdui-text-field>'
            + '<mdui-text-field class="ext-qr-msg" variant="outlined" placeholder="发送内容" style="flex:2;"></mdui-text-field>'
            + '<mdui-button-icon icon="close" class="ext-qr-del" label="删除"></mdui-button-icon>';
          list.appendChild(div);
        });
        dialog.querySelector('#ext-qr-list')?.addEventListener('click', (e) => {
          const delBtn = e.target.closest('.ext-qr-del');
          if (delBtn) delBtn.closest('.ext-qr-item')?.remove();
        });
      }

      dialog.querySelector('[data-action="save"]').addEventListener('click', () => {
        const newSettings = { ...settings };

        // Quick Reply 特殊处理：收集动态列表
        if (ext.id === 'quick-reply') {
          const replies = [];
          dialog.querySelectorAll('.ext-qr-item').forEach((item) => {
            const label = item.querySelector('.ext-qr-label')?.value?.trim() || '';
            const message = item.querySelector('.ext-qr-msg')?.value?.trim() || '';
            if (message) replies.push({ label, message });
          });
          const autoSend = dialog.querySelector('#ext-quick-reply-autoSend')?.checked || false;
          newSettings[ext.id] = { replies, autoSend };
          saveExtensionSettings(newSettings);
          close('saved');
          showSuccess('设置已保存');
          // 通知聊天页面刷新快速回复栏
          document.dispatchEvent(new CustomEvent('quick-reply-updated'));
          return;
        }

        const extData = {};

        // 收集所有输入
        dialog.querySelectorAll('[id^="ext-"]').forEach((el) => {
          const key = el.id.replace(`ext-${ext.id}-`, '');
          if (el.tagName === 'MDUI-SWITCH' || el.type === 'checkbox') {
            extData[key] = el.checked;
          } else if (el.type === 'number') {
            extData[key] = parseInt(el.value, 10) || 0;
          } else {
            extData[key] = el.value;
          }
        });

        newSettings[ext.id] = extData;
        saveExtensionSettings(newSettings);
        close('saved');
        showSuccess('设置已保存');
      });
    },
  });
}

export default { renderExtensions };
