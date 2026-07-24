/**
 * 模块 5: 用户设置
 * 主题、字体、消息显示、快捷键
 * 所有设置实时生效：通过 appState.set('userSettings', ...) 广播，各页面订阅响应
 */
import appState from '../stores/appState.js';
import { themeState } from '../stores/themeState.js';
import storage from '../utils/storage.js';
import { showSuccess, showError } from '../components/Toast.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml } from '../utils/helpers.js';

const STORAGE_KEY = 'cp_user_settings';

const DEFAULT_SETTINGS = {
  theme: 'system',
  chatWidth: 100,
  messageFontSize: 14,
  showTimestamps: true,
  showAvatars: true,
  showFloorNumbers: true,
  displayMode: 'bubble',
  showMessageId: false,
  showMessageTokenCount: false,
  smoothStreaming: true,
  autoScrollToBottom: true,
  sendOnEnter: true,
  confirmMessageDelete: true,
  collapseNewlines: false,
  trimSentences: false,
  expandThinkingAfterComplete: false,
  showThinking: true,
  renderEnabled: true,
  collapseCodeBlock: 'frontend_only',
  customCss: '',
};

/** 从 appState 获取当前用户设置（带默认值合并） */
export function getSettings() {
  const stored = appState.get('userSettings') || {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** 更新单/多字段并广播 + 持久化 */
export function updateSettings(patch) {
  const next = { ...getSettings(), ...patch };
  appState.set('userSettings', next);
  applySettings(next);
}

/**
 * 渲染用户设置模块
 */
export function renderUserSettings(container, opts = {}) {
  const settings = getSettings();

  container.innerHTML = `
    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('palette', 18)}</span>
        主题与外观
      </h3>
      <div class="cp-grid">
        <div class="cp-field">
          <label class="cp-field__label">主题</label>
          <mdui-segmented-button-group id="theme-options" selects="single" value="${settings.theme || 'system'}">
            <mdui-segmented-button value="light">浅色</mdui-segmented-button>
            <mdui-segmented-button value="dark">深色</mdui-segmented-button>
            <mdui-segmented-button value="system">跟随系统</mdui-segmented-button>
          </mdui-segmented-button-group>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">
            聊天宽度
            <span class="cp-field__hint" data-hint="chatWidth">${settings.chatWidth}%</span>
          </label>
          <div class="cp-slider">
            <mdui-slider id="chat-width" min="30" max="100" step="5" value="${settings.chatWidth}"></mdui-slider>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">
            消息字体大小
            <span class="cp-field__hint" data-hint="messageFontSize">${settings.messageFontSize}px</span>
          </label>
          <div class="cp-slider">
            <mdui-slider id="message-font-size" min="12" max="30" step="1" value="${settings.messageFontSize}"></mdui-slider>
          </div>
        </div>
      </div>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('chat', 18)}</span>
        消息显示
      </h3>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">显示时间戳</div>
          <div class="cp-switch-row__desc">在每条消息下方显示发送时间</div>
        </div>
        <mdui-switch id="show-timestamps" ${settings.showTimestamps ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">显示头像</div>
          <div class="cp-switch-row__desc">在消息旁显示用户和 AI 的头像</div>
        </div>
        <mdui-switch id="show-avatars" ${settings.showAvatars ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">显示楼层数</div>
          <div class="cp-switch-row__desc">在每条消息旁显示楼层编号</div>
        </div>
        <mdui-switch id="show-floor-numbers" ${settings.showFloorNumbers ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">平滑流式输出</div>
          <div class="cp-switch-row__desc">AI 生成时使用平滑动画显示文字</div>
        </div>
        <mdui-switch id="smooth-streaming" ${settings.smoothStreaming ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">自动滚动到底部</div>
          <div class="cp-switch-row__desc">AI 生成时自动滚动到最新消息</div>
        </div>
        <mdui-switch id="auto-scroll" ${settings.autoScrollToBottom ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">压缩多余空行</div>
          <div class="cp-switch-row__desc">移除消息中的连续空行</div>
        </div>
        <mdui-switch id="collapse-newlines" ${settings.collapseNewlines ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">修剪句子末尾</div>
          <div class="cp-switch-row__desc">移除消息末尾的空白字符</div>
        </div>
        <mdui-switch id="trim-sentences" ${settings.trimSentences ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">思维链完成后展开</div>
          <div class="cp-switch-row__desc">AI 思考完成后自动展开思维链内容</div>
        </div>
        <mdui-switch id="expand-thinking" ${settings.expandThinkingAfterComplete ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-field" style="margin-top: 16px;">
        <label class="cp-field__label">信息显示方式</label>
        <mdui-segmented-button-group id="display-mode-options" selects="single" value="${settings.displayMode || 'bubble'}">
          <mdui-segmented-button value="bubble">气泡显示</mdui-segmented-button>
          <mdui-segmented-button value="flat">平铺显示</mdui-segmented-button>
        </mdui-segmented-button-group>
      </div>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('code', 18)}</span>
        渲染器
      </h3>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">启用渲染器</div>
          <div class="cp-switch-row__desc">启用后，前端代码块将被渲染为可视化界面</div>
        </div>
        <mdui-switch id="render-enabled" ${settings.renderEnabled ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-field" style="margin-top: 12px;">
        <label class="cp-field__label">代码折叠</label>
        <div class="cp-field__desc" style="margin-bottom: 8px; font-size: 12px; color: rgb(var(--mdui-color-on-surface-variant));">折叠指定类型的代码块，“仅前端”只折叠可渲染但未被渲染的代码块</div>
        <mdui-segmented-button-group id="collapse-code-block" selects="single" value="${settings.collapseCodeBlock || 'frontend_only'}">
          <mdui-segmented-button value="all">全部</mdui-segmented-button>
          <mdui-segmented-button value="frontend_only">仅前端</mdui-segmented-button>
          <mdui-segmented-button value="none">禁用</mdui-segmented-button>
        </mdui-segmented-button-group>
      </div>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('settings', 18)}</span>
        交互设置
      </h3>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">Enter 发送消息</div>
          <div class="cp-switch-row__desc">关闭后需要 Ctrl+Enter 发送</div>
        </div>
        <mdui-switch id="send-on-enter" ${settings.sendOnEnter ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">删除消息前确认</div>
          <div class="cp-switch-row__desc">删除消息时显示确认对话框</div>
        </div>
        <mdui-switch id="confirm-delete" ${settings.confirmMessageDelete ? 'checked' : ''}></mdui-switch>
      </div>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('format', 18)}</span>
        自定义 CSS
      </h3>
      <div class="cp-field">
        <label class="cp-field__label">自定义样式（应用于整个应用）</label>
        <mdui-text-field
          id="custom-css"
          variant="outlined"
          rows="8"
          placeholder="/* 在此输入 CSS 代码 */"
          value="${escapeHtml(settings.customCss || '')}"
          style="width: 100%;"
        ></mdui-text-field>
      </div>
    </div>

    <div class="cp-actions">
      <mdui-button variant="outlined" id="cp-reset-settings">恢复默认</mdui-button>
    </div>
  `;

  bindEvents(container, settings);
  applySettings(settings);
}

function bindEvents(container) {
  // 主题切换
  container.querySelector('#theme-options')?.addEventListener('change', (e) => {
    const theme = e.target.value;
    themeState.setTheme(theme);
    appState.set('theme', theme);
    updateSettings({ theme });
  });

  // 聊天宽度
  const chatWidthSlider = container.querySelector('#chat-width');
  const chatWidthHint = container.querySelector('[data-hint="chatWidth"]');
  chatWidthSlider?.addEventListener('input', () => {
    const v = parseInt(chatWidthSlider.value, 10);
    if (chatWidthHint) chatWidthHint.textContent = `${v}%`;
    updateSettings({ chatWidth: v });
  });

  // 消息字体大小
  const fontSizeSlider = container.querySelector('#message-font-size');
  const fontSizeHint = container.querySelector('[data-hint="messageFontSize"]');
  fontSizeSlider?.addEventListener('input', () => {
    const v = parseInt(fontSizeSlider.value, 10);
    if (fontSizeHint) fontSizeHint.textContent = `${v}px`;
    updateSettings({ messageFontSize: v });
  });

  // 开关
  const switches = [
    { id: 'show-timestamps', key: 'showTimestamps' },
    { id: 'show-avatars', key: 'showAvatars' },
    { id: 'show-floor-numbers', key: 'showFloorNumbers' },
    { id: 'smooth-streaming', key: 'smoothStreaming' },
    { id: 'auto-scroll', key: 'autoScrollToBottom' },
    { id: 'collapse-newlines', key: 'collapseNewlines' },
    { id: 'trim-sentences', key: 'trimSentences' },
    { id: 'send-on-enter', key: 'sendOnEnter' },
    { id: 'confirm-delete', key: 'confirmMessageDelete' },
    { id: 'expand-thinking', key: 'expandThinkingAfterComplete' },
  ];
  switches.forEach(({ id, key }) => {
    const el = container.querySelector(`#${id}`);
    el?.addEventListener('change', () => {
      updateSettings({ [key]: el.checked });
    });
  });

  // 渲染器开关
  container.querySelector('#render-enabled')?.addEventListener('change', (e) => {
    updateSettings({ renderEnabled: e.target.checked });
  });

  // 代码折叠模式
  container.querySelector('#collapse-code-block')?.addEventListener('change', (e) => {
    updateSettings({ collapseCodeBlock: e.target.value });
  });

  // 显示方式切换
  container.querySelector('#display-mode-options')?.addEventListener('change', (e) => {
    updateSettings({ displayMode: e.target.value });
  });

  // 自定义 CSS
  const customCssEl = container.querySelector('#custom-css');
  customCssEl?.addEventListener('input', () => {
    updateSettings({ customCss: customCssEl.value });
  });

  // 恢复默认
  container.querySelector('#cp-reset-settings')?.addEventListener('click', async () => {
    const { confirm } = await import('../components/Modal.js');
    const ok = await confirm('确定要恢复默认设置吗？', '恢复默认');
    if (!ok) return;
    appState.set('userSettings', { ...DEFAULT_SETTINGS });
    renderUserSettings(container, { force: true });
    applySettings({ ...DEFAULT_SETTINGS });
    showSuccess('已恢复默认设置');
  });
}

/**
 * 应用设置到 DOM（由 updateSettings 调用，也可被外部订阅触发）
 */
export function applySettings(settings) {
  const root = document.documentElement;

  // 消息字体大小
  root.style.setProperty('--st-message-font-size', `${settings.messageFontSize}px`);

  // 聊天宽度（修正选择器：原 .app-main 错误，应为 .chat-main）
  const chatMessages = document.querySelector('.chat-main .chat-messages');
  if (chatMessages) {
    chatMessages.style.maxWidth = `${settings.chatWidth}%`;
    chatMessages.style.marginLeft = 'auto';
    chatMessages.style.marginRight = 'auto';
    
    // 当聊天宽度为100%时，移除消息的最大宽度限制
    const messages = chatMessages.querySelectorAll('.message');
    const messageMaxWidth = settings.chatWidth >= 100 ? 'none' : '80%';
    messages.forEach(msg => {
      msg.style.maxWidth = messageMaxWidth;
    });
    
    // 系统消息保持90%宽度
    const systemMessages = chatMessages.querySelectorAll('.message--system');
    systemMessages.forEach(msg => {
      msg.style.maxWidth = '90%';
    });
  }

  // 时间戳/头像显示
  document.body.classList.toggle('st-hide-timestamps', !settings.showTimestamps);
  document.body.classList.toggle('st-hide-avatars', !settings.showAvatars);
  document.body.classList.toggle('st-hide-floor-numbers', !settings.showFloorNumbers);
  document.body.classList.toggle('st-display-flat', settings.displayMode === 'flat');
  // 平滑流式输出：关闭时隐藏光标闪烁动画
  document.body.classList.toggle('st-no-smooth-streaming', !settings.smoothStreaming);

  // 自定义 CSS
  let styleEl = document.getElementById('st-custom-css');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'st-custom-css';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = settings.customCss || '';
}

export default { renderUserSettings, applySettings, updateSettings, getSettings, DEFAULT_SETTINGS };
