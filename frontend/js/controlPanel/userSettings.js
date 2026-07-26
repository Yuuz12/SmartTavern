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
import { escapeHtml, setDialogHighlightConfig } from '../utils/helpers.js';
import { applyThemeColor } from '../utils/mduiTheme.js';

const STORAGE_KEY = 'cp_user_settings';

const THEME_COLOR_PRESETS = [
  { name: '紫', value: '#6750A4' },
  { name: '蓝', value: '#1976D2' },
  { name: '青', value: '#00897B' },
  { name: '绿', value: '#388E3C' },
  { name: '橙', value: '#F57C00' },
  { name: '粉', value: '#C2185B' },
  { name: '红', value: '#D32F2F' },
  { name: '靖蓝', value: '#303F9F' },
];

/**
 * 聊天字体选项
 * 系统字体直接使用本地字体栈；Web 字体按需懒加载（jsDelivr CDN），
 * 加载失败时回退到 family 中声明的本地后备字体，不影响可读性
 */
const CHAT_FONT_OPTIONS = [
  {
    value: 'system',
    label: '系统默认',
    family: `system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif`,
  },
  {
    value: 'noto-sans-sc',
    label: '思源黑体（Noto Sans SC）',
    family: `'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif`,
    webfonts: [
      'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.1.0/index.css',
      'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.1.0/700.css',
    ],
  },
  {
    value: 'noto-serif-sc',
    label: '思源宋体（Noto Serif SC）',
    family: `'Noto Serif SC', 'Songti SC', SimSun, serif`,
    webfonts: [
      'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.1.0/index.css',
      'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.1.0/700.css',
    ],
  },
  {
    value: 'lxgw-wenkai',
    label: '霞鹜文楷（LXGW WenKai）',
    family: `'LXGW WenKai', 'LXGW WenKai SC', 'Kaiti SC', KaiTi, serif`,
    webfonts: ['https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css'],
  },
  {
    value: 'system-serif',
    label: '衬线体（系统）',
    family: `Georgia, 'Times New Roman', 'Songti SC', SimSun, serif`,
  },
];

const DEFAULT_QUOTE_PAIRS = [
  { open: '\u201c', close: '\u201d', name: '中文双引号', enabled: true },
  { open: '\u2018', close: '\u2019', name: '中文单引号', enabled: true },
  { open: '「', close: '」', name: '日式单引号', enabled: true },
  { open: '『', close: '』', name: '日式双引号', enabled: true },
  { open: '【', close: '】', name: '中方括号', enabled: true },
  { open: '（', close: '）', name: '中文括号', enabled: false },
  { open: '(', close: ')', name: '英文括号', enabled: false },
  { open: '"', close: '"', name: '英文双引号', enabled: true },
  { open: "'", close: "'", name: '英文单引号', enabled: true },
];

const DEFAULT_SETTINGS = {
  theme: 'system',
  themeColor: '#6750A4',
  chatWidth: 100,
  chatFont: 'system',
  messageFontSize: 14,
  showTimestamps: true,
  showAvatars: true,
  showFloorNumbers: true,
  displayMode: 'bubble',
  showMessageId: false,
  showMessageTokenCount: false,
  smoothStreaming: true,
  streamBlur: true,
  continueSuffix: 'newline',
  autoScrollToBottom: true,
  sendOnEnter: true,
  confirmMessageDelete: true,
  collapseNewlines: false,
  trimSentences: false,
  expandThinkingAfterComplete: false,
  showThinking: true,
  renderEnabled: true,
  collapseCodeBlock: 'frontend_only',
  aiHelpPrompt: '',
  dialogHighlight: true,
  dialogQuotePairs: DEFAULT_QUOTE_PAIRS,
  dialogHighlightBold: false,
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
          <mdui-select id="theme-options" variant="outlined" value="${settings.theme || 'system'}">
            <mdui-menu-item value="light">浅色</mdui-menu-item>
            <mdui-menu-item value="dark">深色</mdui-menu-item>
            <mdui-menu-item value="system">跟随系统</mdui-menu-item>
          </mdui-select>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">主题色</label>
          <div class="theme-color-swatches" id="theme-color-swatches">
            ${THEME_COLOR_PRESETS.map((c) => `<button class="theme-color-swatch ${settings.themeColor === c.value ? 'theme-color-swatch--active' : ''}" data-color="${c.value}" style="background:${c.value}" title="${c.name}"></button>`).join('')}
            <label class="theme-color-swatch theme-color-swatch--custom" title="自定义">
              <input type="color" id="theme-color-custom" value="${settings.themeColor}" />
              +
            </label>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">聊天字体</label>
          <mdui-select id="chat-font" variant="outlined" value="${settings.chatFont || 'system'}">
            ${CHAT_FONT_OPTIONS.map((f) => `<mdui-menu-item value="${f.value}" style="font-family: ${escapeHtml(f.family)};">${f.label}</mdui-menu-item>`).join('')}
          </mdui-select>
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
          <div class="cp-switch-row__label">流式模糊渐入</div>
          <div class="cp-switch-row__desc">AI 生成时新文字以梯度模糊效果浮现</div>
        </div>
        <mdui-switch id="stream-blur" ${settings.streamBlur ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">续写后缀</div>
          <div class="cp-switch-row__desc">续写时在原文末尾添加的分隔符</div>
        </div>
        <mdui-select id="continue-suffix" variant="outlined" value="${settings.continueSuffix}">
          <mdui-menu-item value="none">无</mdui-menu-item>
          <mdui-menu-item value="space">空格</mdui-menu-item>
          <mdui-menu-item value="newline">换行</mdui-menu-item>
          <mdui-menu-item value="double_newline">双换行</mdui-menu-item>
        </mdui-select>
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
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">信息显示方式</div>
          <div class="cp-switch-row__desc">气泡显示或平铺显示</div>
        </div>
        <mdui-select id="display-mode-options" variant="outlined" value="${settings.displayMode || 'bubble'}">
          <mdui-menu-item value="bubble">气泡</mdui-menu-item>
          <mdui-menu-item value="flat">平铺</mdui-menu-item>
        </mdui-select>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">对话引号设置</div>
          <div class="cp-switch-row__desc">配置对话高亮、引号对与加粗显示</div>
        </div>
        <mdui-button id="edit-dialog-quotes" variant="outlined">编辑</mdui-button>
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
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">代码折叠</div>
          <div class="cp-switch-row__desc">折叠指定类型的代码块，“仅前端”只折叠可渲染但未被渲染的代码块</div>
        </div>
        <mdui-select id="collapse-code-block" variant="outlined" value="${settings.collapseCodeBlock || 'frontend_only'}">
          <mdui-menu-item value="all">全部</mdui-menu-item>
          <mdui-menu-item value="frontend_only">仅前端</mdui-menu-item>
          <mdui-menu-item value="none">禁用</mdui-menu-item>
        </mdui-select>
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
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">AI 帮答提示词</div>
          <div class="cp-switch-row__desc">自定义帮答系统提示词，留空使用默认</div>
        </div>
        <mdui-button id="edit-ai-help-prompt" variant="outlined">编辑</mdui-button>
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

  // 主题色选择
  const swatches = container.querySelector('#theme-color-swatches');
  swatches?.querySelectorAll('.theme-color-swatch[data-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      swatches.querySelectorAll('.theme-color-swatch').forEach((s) => s.classList.remove('theme-color-swatch--active'));
      btn.classList.add('theme-color-swatch--active');
      updateSettings({ themeColor: color });
    });
  });
  const customColorInput = container.querySelector('#theme-color-custom');
  customColorInput?.addEventListener('input', () => {
    const color = customColorInput.value;
    swatches.querySelectorAll('.theme-color-swatch[data-color]').forEach((s) => s.classList.remove('theme-color-swatch--active'));
    updateSettings({ themeColor: color });
  });

  // 聊天字体
  const chatFontSelect = container.querySelector('#chat-font');
  chatFontSelect?.addEventListener('change', () => {
    updateSettings({ chatFont: chatFontSelect.value });
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
    { id: 'stream-blur', key: 'streamBlur' },
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

  // 续写后缀
  container.querySelector('#continue-suffix')?.addEventListener('change', (e) => {
    updateSettings({ continueSuffix: e.target.value });
  });

  // 自定义 CSS
  const customCssEl = container.querySelector('#custom-css');
  customCssEl?.addEventListener('input', () => {
    updateSettings({ customCss: customCssEl.value });
  });

  // AI 帮答提示词
  container.querySelector('#edit-ai-help-prompt')?.addEventListener('click', async () => {
    const { showModal } = await import('../components/Modal.js');
    const current = getSettings().aiHelpPrompt || '';
    const result = await showModal({
      title: 'AI 帮答提示词',
      content: `
        <p style="margin: 0 0 8px; font-size: 12px; color: rgb(var(--mdui-color-on-surface-variant));">留空则使用内置默认提示词</p>
        <mdui-text-field id="ai-help-prompt-input" variant="outlined" rows="6" placeholder="留空使用默认" value="${escapeHtml(current)}" style="width: 100%;"></mdui-text-field>
      `,
      actions: [
        { text: '取消', value: 'cancel', type: 'text' },
        { text: '保存', value: 'ok', type: 'filled' },
      ],
      onMount: (dialog, close) => {
        const input = dialog.querySelector('#ai-help-prompt-input');
        dialog.querySelector('[data-action="ok"]').addEventListener('click', () => {
          close(input.value);
        });
      },
    });
    if (result !== null && result !== 'cancel') {
      updateSettings({ aiHelpPrompt: result });
    }
  });

  // 人物对话引号对编辑
  container.querySelector('#edit-dialog-quotes')?.addEventListener('click', async () => {
    const { showModal } = await import('../components/Modal.js');
    let pairs = (getSettings().dialogQuotePairs || []).map((p) => ({ ...p }));
    const result = await showModal({
      title: '对话引号对',
      content: `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">
          <div>
            <div style="font-size:15px;">启用对话高亮</div>
            <div style="font-size:12px;color:rgb(var(--mdui-color-on-surface-variant,73 69 79));">用主题色高亮引号包裹的对话内容</div>
          </div>
          <mdui-switch id="dialog-highlight-toggle" ${getSettings().dialogHighlight ? 'checked' : ''}></mdui-switch>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">
          <div>
            <div style="font-size:15px;">对话高亮加粗</div>
            <div style="font-size:12px;color:rgb(var(--mdui-color-on-surface-variant,73 69 79));">将高亮的对话文字加粗显示</div>
          </div>
          <mdui-switch id="dialog-bold-toggle" ${getSettings().dialogHighlightBold ? 'checked' : ''}></mdui-switch>
        </div>
        <div id="dialog-quote-list" style="display:flex;flex-direction:column;gap:6px;min-width:300px;"></div>
        <mdui-divider style="margin:12px 0;"></mdui-divider>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <mdui-text-field id="new-quote-name" variant="outlined" label="名称" style="flex:1;min-width:100px;"></mdui-text-field>
          <mdui-text-field id="new-quote-open" variant="outlined" label="开" style="width:64px;"></mdui-text-field>
          <mdui-text-field id="new-quote-close" variant="outlined" label="闭" style="width:64px;"></mdui-text-field>
          <mdui-button id="add-quote-pair" variant="tonal">添加</mdui-button>
        </div>
      `,
      actions: [
        { text: '重置默认', value: 'reset', type: 'text' },
        { text: '取消', value: 'cancel', type: 'text' },
        { text: '保存', value: 'ok', type: 'filled' },
      ],
      onMount: (dialog, close) => {
        const listEl = dialog.querySelector('#dialog-quote-list');
        const saveBtn = dialog.querySelector('[data-action="ok"]');
        const resetBtn = dialog.querySelector('[data-action="reset"]');

        // 启用对话高亮开关：实时保存
        const highlightToggle = dialog.querySelector('#dialog-highlight-toggle');
        highlightToggle?.addEventListener('change', (e) => {
          updateSettings({ dialogHighlight: e.target.checked });
        });
        // 对话高亮加粗开关：实时保存
        const boldToggle = dialog.querySelector('#dialog-bold-toggle');
        boldToggle?.addEventListener('change', (e) => {
          updateSettings({ dialogHighlightBold: e.target.checked });
        });

        const renderList = () => {
          listEl.innerHTML = pairs.map((p, i) => `
            <div style="display:flex;align-items:center;gap:12px;padding:6px 8px;border-radius:8px;background:rgb(var(--mdui-color-surface-container-high,236 230 240));">
              <mdui-switch ${p.enabled ? 'checked' : ''} data-toggle="${i}"></mdui-switch>
              <span style="font-size:15px;min-width:80px;">${escapeHtml(p.open)}内容${escapeHtml(p.close)}</span>
              <span style="flex:1;font-size:12px;color:rgb(var(--mdui-color-on-surface-variant,73 69 79));">${escapeHtml(p.name)}</span>
              <mdui-button-icon icon="delete" data-del="${i}" label="删除" style="color: var(--md-sys-color-error);"></mdui-button-icon>
            </div>
          `).join('');
          listEl.querySelectorAll('[data-toggle]').forEach((sw) => {
            sw.addEventListener('change', (e) => {
              const idx = Number(sw.dataset.toggle);
              pairs[idx].enabled = e.target.checked;
            });
          });
          listEl.querySelectorAll('[data-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
              pairs.splice(Number(btn.dataset.del), 1);
              renderList();
            });
          });
        };
        renderList();
        dialog.querySelector('#add-quote-pair').addEventListener('click', () => {
          const nameEl = dialog.querySelector('#new-quote-name');
          const openEl = dialog.querySelector('#new-quote-open');
          const closeEl = dialog.querySelector('#new-quote-close');
          const open = openEl.value;
          const close = closeEl.value;
          if (!open || !close) { showError('请输入开闭引号'); return; }
          pairs.push({ name: nameEl.value.trim() || '自定义', open, close, enabled: true });
          nameEl.value = ''; openEl.value = ''; closeEl.value = '';
          renderList();
        });
        // 重置按钮：用 capture 阶段绑定并阻止 Modal.js 自动绑定的 close('reset')，避免关闭对话框
        resetBtn.addEventListener('click', (e) => {
          e.stopImmediatePropagation();
          pairs = DEFAULT_QUOTE_PAIRS.map((p) => ({ ...p }));
          renderList();
          showSuccess('已重置为默认引号对');
        }, true);
        // 保存按钮：用 capture 阶段绑定，确保 close(pairs) 先于 Modal.js 的 close('ok') 执行
        saveBtn.addEventListener('click', (e) => {
          e.stopImmediatePropagation();
          close(pairs);
        }, true);
      },
    });
    if (Array.isArray(result)) {
      updateSettings({ dialogQuotePairs: result });
      showSuccess('已保存引号对');
    }
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

/** 按需注入 Web 字体样式表（同一字体只注入一次） */
function ensureWebfontsLoaded(fontValue, urls) {
  urls.forEach((url, i) => {
    const id = `st-chat-font-${fontValue}-${i}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  });
}

/**
 * 应用设置到 DOM（由 updateSettings 调用，也可被外部订阅触发）
 */
export function applySettings(settings) {
  const root = document.documentElement;

  // 主题色
  if (settings.themeColor) {
    applyThemeColor(settings.themeColor);
  }

  // 消息字体大小
  root.style.setProperty('--st-message-font-size', `${settings.messageFontSize}px`);

  // 聊天字体
  const fontOpt = CHAT_FONT_OPTIONS.find((f) => f.value === (settings.chatFont || 'system')) || CHAT_FONT_OPTIONS[0];
  if (fontOpt.webfonts) ensureWebfontsLoaded(fontOpt.value, fontOpt.webfonts);
  root.style.setProperty('--st-chat-font', fontOpt.family);

  // 聊天宽度
  const chatMessages = document.querySelector('.chat-main .chat-messages');
  if (chatMessages) {
    chatMessages.style.maxWidth = `${settings.chatWidth}%`;
    chatMessages.style.marginLeft = 'auto';
    chatMessages.style.marginRight = 'auto';
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

  // 人物对话高亮
  setDialogHighlightConfig(settings.dialogHighlight !== false, settings.dialogQuotePairs);
  document.body.classList.toggle('st-dialog-quote-bold', settings.dialogHighlightBold === true);
}

export default { renderUserSettings, applySettings, updateSettings, getSettings, DEFAULT_SETTINGS };
