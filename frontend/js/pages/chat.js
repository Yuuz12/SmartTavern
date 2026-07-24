/**
 * 聊天主页面逻辑
 */
import { userState } from '../stores/userState.js';
import { themeState } from '../stores/themeState.js';
import appState from '../stores/appState.js';
import { characterApi, worldbookApi, llmConfigApi, conversationApi, authApi, userApi } from '../api/index.js';
import { showToast, showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm, prompt } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { initMduiTheme } from '../utils/mduiTheme.js';
import { formatRelativeTime, formatTime, renderMarkdown, escapeHtml, truncate, copyToClipboard, debounce } from '../utils/helpers.js';
import { applyCodeRendering } from '../utils/codeRenderer.js';
import { applyRegexScripts } from '../utils/regexEngine.js';
import storage from '../utils/storage.js';
import controlPanel from '../controlPanel/index.js';
import { renderResponseConfig, getCurrentPrompts, applyActivePresetRegex } from '../controlPanel/responseConfig.js';
import * as userSettingsModule from '../controlPanel/userSettings.js';

// ============ 全局状态 ============
let currentAbortController = null;
let isGenerating = false;
let isMemoryGenerating = false;
let convSearchKeyword = '';

/** 流式输出逐字模糊：将容器内最后 N 个字符按梯度模糊（越靠后模糊度越高） */
function blurTrailingText(container, charCount) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let lastNode = null;
  while (walker.nextNode()) lastNode = walker.currentNode;
  if (!lastNode || !lastNode.parentNode) return;
  const text = lastNode.textContent;
  if (!text) return;
  const totalBlur = Math.min(charCount, text.length);
  if (totalBlur <= 0) return;

  // 拆分为 4 段梯度模糊
  const segments = 4;
  const segLen = Math.ceil(totalBlur / segments);
  const blurText = text.slice(text.length - totalBlur);
  lastNode.textContent = text.slice(0, text.length - totalBlur);

  const frag = document.createDocumentFragment();
  for (let i = 0; i < segments; i++) {
    const start = i * segLen;
    const end = Math.min(start + segLen, totalBlur);
    if (start >= totalBlur) break;
    const span = document.createElement('span');
    span.className = 'st-char-blur';
    // 梯度：第1段最清晰，第4段最模糊
    const level = (i + 1) / segments; // 0.25, 0.5, 0.75, 1.0
    span.style.filter = 'blur(' + (level * 4).toFixed(1) + 'px)';
    span.style.opacity = String(1 - level * 0.55); // 0.86, 0.72, 0.59, 0.45
    span.textContent = blurText.slice(start, end);
    frag.appendChild(span);
  }
  lastNode.parentNode.insertBefore(frag, lastNode.nextSibling);
}

/** 获取有效正则脚本：用户自定义 + 当前激活预设自带的正则 */
function getEffectiveRegexScripts() {
  const userScripts = appState.get('regexScripts') || [];
  const presetScripts = appState.get('presetRegexScripts') || [];
  if (presetScripts.length === 0) return userScripts;
  if (userScripts.length === 0) return presetScripts;
  return [...userScripts, ...presetScripts];
}

/** 获取传递给后端的预设正则（用于 prompt 目标） */
function getRegexExtraBody() {
  const presetScripts = appState.get('presetRegexScripts') || [];
  return presetScripts.length > 0 ? { presetRegexScripts: presetScripts } : undefined;
}

// ============ 初始化 ============
async function init() {
  initMduiTheme();
  themeState.init();

  // 检查登录
  const user = await userState.init();
  if (!user) {
    window.location.replace('/pages/login.html');
    return;
  }

  // 检查是否需要强制修改密码（管理员创建的用户首次登录）
  if (user.mustChangePassword) {
    const changed = await showForcePasswordDialog();
    if (!changed) {
      // 用户取消，退出登录
      await userState.logout();
      return;
    }
  }

  // 用户信息
  renderUserInfo();

  // 加载数据（对话列表不再渲染到侧栏，仅缓存供角色 dialog 使用）
  await Promise.all([
    loadConversations(),
    loadCharacters(),
    loadLlmConfigs(),
    loadWorldbooks(),
  ]);

  // 加载正则脚本到 appState
  try {
    const regexScripts = await userApi.getRegexScripts(user.id);
    appState.set('regexScripts', regexScripts || []);
  } catch { /* 忽略 */ }

  // 加载当前激活预设的正则脚本
  applyActivePresetRegex();

  // 监听 iframe 渲染器发来的消息（填入输入框 / 发送 / 触发生成）
  window.addEventListener('message', (e) => {
    if (!e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'ST_FILL_INPUT') {
      const input = document.getElementById('message-input');
      if (input) {
        input.value = e.data.text || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    } else if (e.data.type === 'ST_SEND') {
      const input = document.getElementById('message-input');
      if (input) {
        input.value = e.data.text || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sendMessage();
      }
    } else if (e.data.type === 'ST_TRIGGER') {
      // /trigger 命令：触发 AI 回复（相当于点击发送按钮）
      sendMessage();
    }
  });

  // 初始化控制面板
  controlPanel.init();

  // 把回应配置渲染到左侧栏
  const sidebarRespConfig = document.getElementById('sidebar-response-config');
  if (sidebarRespConfig) {
    renderResponseConfig(sidebarRespConfig);
  }

  // 绑定事件
  bindEvents();

  // 初始渲染快速回复栏
  renderQuickReplies();

  // 监听快速回复设置更新
  document.addEventListener('quick-reply-updated', renderQuickReplies);

  // 监听状态变化
  appState.subscribe('sidebarCollapsed', applySidebarState);
  appState.subscribe('asideCollapsed', applyAsideState);
  // 用户设置变化时：应用 DOM 样式 + 重新渲染消息（让 collapseNewlines/trimSentences 立即生效）
  appState.subscribe('userSettings', (newSettings) => {
    userSettingsModule.applySettings(newSettings);
    renderMessages();
  });
  // 初始状态
  applySidebarState();
  applyAsideState();
  // 应用初始用户设置
  userSettingsModule.applySettings(appState.get('userSettings'));
  // 同步 drawer 关闭事件（用户点击遮罩或 ESC 关闭时同步到 appState）
  syncDrawerCloseState();
}

// ============ 用户信息 ============
function renderUserInfo() {
  const user = userState.getCurrentUser();
  if (!user) return;

  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  if (nameEl) nameEl.textContent = user.username;
  if (roleEl) roleEl.textContent = user.role === 'admin' ? '管理员' : '用户';

  // 更新用户列表项的 avatar/icon
  const userInfoEl = document.getElementById('user-info');
  if (userInfoEl && user.avatar) {
    userInfoEl.setAttribute('icon', '');
    // 自定义头像需通过 slot
    const existingAvatar = userInfoEl.querySelector('[slot="icon"]');
    if (existingAvatar) existingAvatar.remove();
    const avatarImg = document.createElement('mdui-avatar');
    avatarImg.setAttribute('slot', 'icon');
    avatarImg.src = user.avatar;
    userInfoEl.appendChild(avatarImg);
  }
}

// ============ 加载对话列表 ============
async function loadConversations() {
  try {
    const list = await conversationApi.list(convSearchKeyword ? { search: convSearchKeyword } : undefined);
    appState.set('conversations', list);
  } catch (err) {
    showError(err.message || '加载对话列表失败');
  }
}

// ============ 加载角色卡 / LLM 配置 ============
async function loadCharacters() {
  try {
    const list = await characterApi.list();
    appState.set('characters', list);
  } catch (err) {
    showError(err.message || '加载角色卡失败');
  }
}

async function loadLlmConfigs() {
  try {
    const list = await llmConfigApi.list();
    appState.set('llmConfigs', list);
  } catch (err) {
    showError(err.message || '加载 LLM 配置失败');
  }
}

async function loadWorldbooks() {
  try {
    const list = await worldbookApi.list();
    appState.set('worldbooks', list);
  } catch (err) {
    // 静默失败，世界书非必需
    appState.set('worldbooks', []);
  }
}

// ============ 选中对话 ============
export async function selectConversation(id) {
  try {
    const conv = await conversationApi.get(id);
    appState.set('currentConversation', conv);
    renderMessages();
    renderAside();
    renderTopBar();
    renderQuickReplies();
    document.getElementById('chat-input-area').style.display = 'flex';

    // 移动端关闭侧栏
    closeMobileSidebar();
  } catch (err) {
    showError(err.message || '加载对话失败');
  }
}

// ============ 顶部信息 ============
function renderTopBar() {
  const conv = appState.get('currentConversation');
  const titleEl = document.getElementById('current-conv-title');
  const subtitleEl = document.getElementById('current-conv-subtitle');

  if (!conv) {
    if (titleEl) titleEl.textContent = '选择或创建对话';
    if (subtitleEl) subtitleEl.textContent = '';
    return;
  }

  if (titleEl) titleEl.textContent = conv.title || '未命名对话';
  const msgCount = conv.messages?.length || 0;
  if (subtitleEl) subtitleEl.textContent = `${msgCount} 条消息`;
}

// ============ 渲染消息 ============
function renderMessages() {
  const container = document.getElementById('chat-messages');
  const conv = appState.get('currentConversation');

  if (!conv) {
    container.classList.add('chat-messages--empty');
    container.innerHTML = `
      <div class="chat-empty" id="chat-empty">
        <div class="chat-empty__icon">
          <svg viewBox="0 0 24 24" width="64" height="64" aria-hidden="true">
            <path fill="currentColor" d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
        </div>
        <h2 class="chat-empty__title">开始一段新的对话</h2>
        <p class="chat-empty__description">选择角色卡与 LLM 配置，开启你的角色扮演之旅</p>
        <mdui-button variant="filled" id="empty-new-conv">创建对话</mdui-button>
      </div>
    `;
    document.getElementById('empty-new-conv')?.addEventListener('click', showCreateConversationModal);
    return;
  }

  container.classList.remove('chat-messages--empty');

  const messages = conv.messages || [];
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="flex: 1;">
        <p class="empty-state__description">发送第一条消息开始对话</p>
      </div>
    `;
    return;
  }

  const user = userState.getCurrentUser();
  const characters = appState.get('characters');
  const character = characters?.find((c) => c.id === conv.characterId);

  container.innerHTML = messages
    .map((msg, index) => renderMessageHtml(msg, user, character, index + 1))
    .join('');

  // 通过 JS 属性设置思维链折叠状态（HTML value 属性不可靠）
  syncThinkingCollapseValue(container);

  // 绑定操作按钮
  container.querySelectorAll('[data-action="edit-msg"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const msgId = btn.dataset.msgId;
      const target = messages.find((m) => m.id === msgId);
      if (!target) return;
      const msgEl = container.querySelector(`[data-msg-id="${msgId}"]`);
      if (!msgEl) return;
      const bubble = msgEl.querySelector('.message__bubble');
      if (!bubble || bubble.querySelector('.msg-edit-area')) return;

      // 保存原始 HTML
      const originalHtml = bubble.innerHTML;
      const rawContent = target.content || '';

      // 替换为编辑区域
      bubble.innerHTML = `
        <div class="msg-edit-area">
          <textarea class="msg-edit-textarea">${escapeHtml(rawContent)}</textarea>
          <div class="msg-edit-actions">
            <mdui-button variant="filled" class="msg-edit-save">保存</mdui-button>
            <mdui-button variant="text" class="msg-edit-cancel">取消</mdui-button>
          </div>
        </div>
      `;

      const textarea = bubble.querySelector('.msg-edit-textarea');
      textarea.focus();
      // 自动调整高度
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      });

      // 取消
      bubble.querySelector('.msg-edit-cancel').addEventListener('click', () => {
        bubble.innerHTML = originalHtml;
        // 重新应用代码渲染
        const renderSettings = userSettingsModule.getSettings();
        applyCodeRendering(bubble, renderSettings);
      });

      // 保存
      bubble.querySelector('.msg-edit-save').addEventListener('click', async () => {
        const newContent = textarea.value;
        try {
          await conversationApi.updateMessage(conv.id, msgId, newContent);
          showSuccess('已保存');
          await selectConversation(conv.id);
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    });
  });

  container.querySelectorAll('[data-action="copy"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msgId = btn.dataset.msgId;
      const target = messages.find((m) => m.id === msgId);
      if (!target) return;
      const ok = await copyToClipboard(target.content);
      if (ok) showSuccess('已复制到剪贴板');
      else showError('复制失败');
    });
  });

  container.querySelectorAll('[data-action="delete-msg"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msgId = btn.dataset.msgId;
      const userSettings = appState.get('userSettings') || {};
      if (userSettings.confirmMessageDelete !== false) {
        const ok = await confirm('确定要删除这条消息吗？', '删除消息');
        if (!ok) return;
      }
      try {
        await conversationApi.deleteMessage(conv.id, msgId);
        await selectConversation(conv.id);
      } catch (err) {
        showError(err.message || '删除失败');
      }
    });
  });

  // Swipe 重新生成
  container.querySelectorAll('[data-action="swipe-regen"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (isGenerating) return;
      const msgId = btn.dataset.msgId;
      const msgEl = container.querySelector(`.message[data-msg-id="${msgId}"]`);
      if (!msgEl) return;
      const contentEl = msgEl.querySelector('.message__content');
      const bubble = msgEl.querySelector('.message__bubble');
      if (!bubble || !contentEl) return;

      setGenerating(true);
      const originalHtml = bubble.innerHTML;

      // 隐藏原有思维链（避免重新生成时出现两个思维链）
      const existingThinking = contentEl.querySelector('.message__thinking');
      if (existingThinking) existingThinking.style.display = 'none';

      // 插入新的思维链容器（在 bubble 前面）
      const thinkingContainer = document.createElement('div');
      thinkingContainer.className = 'swipe-thinking-container';
      contentEl.insertBefore(thinkingContainer, bubble);

      bubble.classList.add('message__bubble--streaming');
      bubble.innerHTML = '<em style="color: rgb(var(--mdui-color-on-surface-variant));">正在思考...</em>';

      let fullContent = '';
      let fullThinking = '';
      let typingIndicatorRemoved = false;
      let doneReceived = false;

      const updateThinking = () => {
        if (userSettingsModule.getSettings().showThinking === false) return;
        if (!fullThinking) return;
        const bodyEl = thinkingContainer.querySelector('.message__thinking-body');
        if (bodyEl) {
          bodyEl.textContent = fullThinking;
        } else {
          thinkingContainer.innerHTML = renderThinkingHtml(fullThinking, true);
          syncThinkingCollapseValue(thinkingContainer);
        }
      };
      const finishThinking = () => {
        if (userSettingsModule.getSettings().showThinking === false) return;
        if (!fullThinking) return;
        const userSettings = userSettingsModule.getSettings();
        const shouldExpand = userSettings.expandThinkingAfterComplete === true;
        thinkingContainer.innerHTML = renderThinkingHtml(fullThinking, false, !shouldExpand);
        syncThinkingCollapseValue(thinkingContainer);
      };
      const cleanup = () => {
        bubble.classList.remove('message__bubble--streaming');
        if (fullThinking) bubble.classList.add('message__bubble--has-thinking');
      };

      try {
        currentAbortController = new AbortController();
        await conversationApi.swipe(conv.id, {
          onThinking: (chunk) => {
            fullThinking += chunk;
            if (!typingIndicatorRemoved) updateThinking();
            scrollToBottom();
          },
          onChunk: (chunk) => {
            if (!typingIndicatorRemoved) {
              bubble.innerHTML = '';
              typingIndicatorRemoved = true;
              finishThinking();
            }
            fullContent += chunk;
            bubble.innerHTML = renderMarkdown(fullContent);
            scrollToBottom();
          },
          onDone: () => {
            doneReceived = true;
            finishThinking();
            cleanup();
            if (!typingIndicatorRemoved) {
              bubble.innerHTML = renderMarkdown(fullContent) || '<em>(空回复)</em>';
            }
            selectConversation(conv.id);
          },
          onMemoryGenerating: () => { setMemoryGenerating(true); },
          onMemoryDone: () => { setMemoryGenerating(false); },
          onError: (err) => {
            doneReceived = true;
            finishThinking();
            cleanup();
            if (err.name === 'AbortError') {
              thinkingContainer.remove();
              if (existingThinking) existingThinking.style.display = '';
              if (!fullContent) {
                bubble.innerHTML = originalHtml;
              }
              return;
            }
            thinkingContainer.remove();
            if (existingThinking) existingThinking.style.display = '';
            bubble.innerHTML = `<em style="color: rgb(var(--mdui-color-error));">生成失败: ${escapeHtml(err.message)}</em>`;
            showError(err.message || '生成失败');
          },
        }, currentAbortController.signal, getRegexExtraBody());
        finishThinking();
        // 流结束但未收到 done/error 事件，恢复原始内容
        if (!doneReceived) {
          cleanup();
          thinkingContainer.remove();
          if (existingThinking) existingThinking.style.display = '';
          bubble.innerHTML = originalHtml;
        }
      } catch (err) {
        finishThinking();
        cleanup();
        if (err.name !== 'AbortError') {
          thinkingContainer.remove();
          if (existingThinking) existingThinking.style.display = '';
          bubble.innerHTML = originalHtml;
          showError(err.message || '重新生成失败');
        }
      } finally {
        currentAbortController = null;
        setGenerating(false);
        if (isMemoryGenerating) setMemoryGenerating(false);
      }
    });
  });

  // Swipe 切换（上一个/下一个）
  container.querySelectorAll('[data-action="swipe-prev"], [data-action="swipe-next"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msgId = btn.dataset.msgId;
      const target = messages.find((m) => m.id === msgId);
      if (!target || !target.swipes || target.swipes.length <= 1) return;

      const currentIndex = target.swipeIndex ?? 0;
      const isPrev = btn.dataset.action === 'swipe-prev';
      const newIndex = isPrev ? currentIndex - 1 : currentIndex + 1;
      if (newIndex < 0 || newIndex >= target.swipes.length) return;

      try {
        await conversationApi.switchSwipe(conv.id, msgId, newIndex);
        // 更新本地数据并重新渲染
        await selectConversation(conv.id);
      } catch (err) {
        showError(err.message || '切换失败');
      }
    });
  });

  // mdui-collapse 组件自身处理折叠/展开，无需手动绑定事件

  // 应用代码渲染器（前端代码 iframe 渲染 + 代码折叠）
  const renderSettings = userSettingsModule.getSettings();
  applyCodeRendering(container, renderSettings);

  // 滚动到底部
  scrollToBottom();
}

function renderMessageHtml(msg, user, character, floorNumber) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const roleClass = isUser ? 'message--user' : isSystem ? 'message--system' : 'message--assistant';
  const avatarContent = isUser
    ? (user?.avatar ? `<img src="${user.avatar}" alt="" />` : escapeHtml(user?.username?.charAt(0).toUpperCase() || 'U'))
    : (character?.avatar ? `<img src="${character.avatar}" alt="" />` : escapeHtml(character?.name?.charAt(0).toUpperCase() || 'AI'));

  // 应用用户设置：压缩空行 / 修剪末尾空白
  const userSettings = appState.get('userSettings') || {};
  let rawContent = msg.content || '';
  if (userSettings.trimSentences) rawContent = rawContent.replace(/\s+$/g, '');
  if (userSettings.collapseNewlines) rawContent = rawContent.replace(/\n{3,}/g, '\n\n');

  // 应用正则脚本：显示替换（用户正则 + 预设正则）
  const regexScripts = getEffectiveRegexScripts();
  if (regexScripts.length > 0 && !isSystem) {
    const conv = appState.get('currentConversation');
    rawContent = applyRegexScripts(rawContent, regexScripts, {
      target: 'display',
      characterId: conv?.characterId,
    });
  }

  const content = isSystem ? `<em>${escapeHtml(rawContent)}</em>` : renderMarkdown(rawContent);
  const time = formatTime(msg.timestamp);

  // 思维链内容（有 swipes 时从 swipeThinkings 读取对应索引，否则从 metadata 读取）
  const thinking = (msg.swipes && msg.swipeThinkings)
    ? msg.swipeThinkings[msg.swipeIndex ?? 0]
    : msg.metadata?.thinking;
  // 是否显示思维链（关闭后模型仍会思考，仅隐藏显示）
  const showThinking = userSettings.showThinking !== false;
  // 根据用户设置决定历史消息思维链是否默认收起（与流式完成时一致）
  const shouldExpandThinking = userSettings.expandThinkingAfterComplete === true;
  const thinkingHtml = (showThinking && thinking && !isSystem && !isUser)
    ? renderThinkingHtml(thinking, false, !shouldExpandThinking)
    : '';

  const bubbleClass = thinkingHtml ? 'message__bubble message__bubble--has-thinking' : 'message__bubble';

  const actions = isSystem ? '' : `
    <div class="message__actions">
      <button class="message__action-btn" data-action="edit-msg" data-msg-id="${msg.id}" title="编辑" aria-label="编辑">
        ${getIcon('edit', 16)}
      </button>
      <button class="message__action-btn" data-action="copy" data-msg-id="${msg.id}" title="复制" aria-label="复制">
        ${getIcon('copy', 16)}
      </button>
      <button class="message__action-btn" data-action="delete-msg" data-msg-id="${msg.id}" title="删除" aria-label="删除">
        ${getIcon('delete', 16)}
      </button>
      ${!isUser ? `
      <button class="message__action-btn" data-action="swipe-regen" data-msg-id="${msg.id}" title="重新生成" aria-label="重新生成">
        ${getIcon('refresh', 16)}
      </button>
      <div class="message__swipe-nav">
        <button class="message__action-btn" data-action="swipe-prev" data-msg-id="${msg.id}" title="上一个回复" aria-label="上一个回复">
          ${getIcon('arrowBack', 16)}
        </button>
        <span class="message__swipe-counter">${(msg.swipeIndex ?? 0) + 1}/${msg.swipes?.length || 1}</span>
        <button class="message__action-btn" data-action="swipe-next" data-msg-id="${msg.id}" title="下一个回复" aria-label="下一个回复">
          ${getIcon('arrowForward', 16)}
        </button>
      </div>
      ` : ''}
    </div>
  `;

  // 楼层 + 生成统计
  let floorHtml = '';
  if (floorNumber) {
    let statsText = '';
    if (!isUser && msg.metadata?.duration) {
      const sec = (msg.metadata.duration / 1000).toFixed(1);
      const tokens = msg.metadata.tokens || 0;
      const tps = msg.metadata.duration > 0 && tokens > 0 ? Math.round(tokens / (msg.metadata.duration / 1000)) : 0;
      statsText = ` · ${sec}s ${tokens}t ${tps}t/s`;
    }
    floorHtml = `<div class="message__floor">#${floorNumber}${statsText}</div>`;
  }

  return `
    <div class="message ${roleClass}" data-msg-id="${msg.id}">
      <div class="message__avatar">${avatarContent}</div>
      <div class="message__content">
        ${floorHtml}
        ${thinkingHtml}
        <div class="${bubbleClass}">${content}</div>
        <div class="message__time">${time}</div>
        ${actions}
      </div>
    </div>
  `;
}

/**
 * 渲染思维链 HTML（使用 mdui-collapse 组件）
 */
function renderThinkingHtml(thinking, streaming = false, collapsed = false) {
  if (!thinking) return '';
  const wrapperClasses = [
    'message__thinking',
    streaming ? 'message__thinking--streaming' : '',
  ].filter(Boolean).join(' ');

  const headerContent = `
    <span class="message__thinking-header__icon">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
    </span>
    <span class="message__thinking-header__title">${streaming ? '正在思考...' : '思维链'}</span>
  `;

  return `
    <div class="${wrapperClasses}" data-thinking>
      <mdui-collapse class="message__thinking-collapse" accordion data-collapsed="${collapsed}">
        <mdui-collapse-item value="thinking">
          <span slot="header" class="message__thinking-header">${headerContent}</span>
          <div class="message__thinking-body">${escapeHtml(thinking)}</div>
        </mdui-collapse-item>
      </mdui-collapse>
    </div>
  `;
}

// mdui-collapse 的 value HTML 属性在 accordion=false 时无法设置初始值，
// 即使 accordion=true 时通过 innerHTML 创建也存在升级时序问题，
// 因此统一通过 JS 属性设置展开/收起状态。
function syncThinkingCollapseValue(scope) {
  scope.querySelectorAll('mdui-collapse[data-collapsed]').forEach((el) => {
    el.value = el.dataset.collapsed === 'true' ? '' : 'thinking';
  });
}

function scrollToBottom() {
  // 受用户设置 autoScrollToBottom 控制
  const userSettings = appState.get('userSettings') || {};
  if (userSettings.autoScrollToBottom === false) return;
  const container = document.getElementById('chat-messages');
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ============ 右侧详情面板 ============
function renderAside() {
  const container = document.getElementById('aside-content');
  const conv = appState.get('currentConversation');

  if (!conv) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__description">未选中对话</p>
      </div>
    `;
    return;
  }

  const characters = appState.get('characters');
  const llmConfigs = appState.get('llmConfigs');
  const character = characters?.find((c) => c.id === conv.characterId);
  const llmConfig = llmConfigs?.find((c) => c.id === conv.llmConfigId);

  const msgCount = conv.messages?.length || 0;
  const userMessages = conv.messages?.filter((m) => m.role === 'user').length || 0;
  const aiMessages = conv.messages?.filter((m) => m.role === 'assistant').length || 0;

  container.innerHTML = `
    <div class="aside__section">
      <div class="aside__section-title">对话信息</div>
      <div class="aside__field">
        <span class="aside__field-label">标题</span>
        <span class="aside__field-value">${escapeHtml(conv.title || '未命名对话')}</span>
      </div>
      <div class="aside__field">
        <span class="aside__field-label">创建时间</span>
        <span class="aside__field-value">${formatRelativeTime(conv.createdAt)}</span>
      </div>
      <div class="aside__field">
        <span class="aside__field-label">最后更新</span>
        <span class="aside__field-value">${formatRelativeTime(conv.updatedAt)}</span>
      </div>
    </div>

    <div class="aside__section">
      <div class="aside__section-title">角色卡</div>
      <div class="aside__field">
        <span class="aside__field-label">名称</span>
        <span class="aside__field-value">${character ? escapeHtml(character.name) : '已删除'}</span>
      </div>
      ${character?.description ? `
        <div class="aside__field aside__field--block">
          <span class="aside__field-label">描述</span>
          <span class="aside__field-value">${escapeHtml(truncate(character.description, 200))}</span>
        </div>
      ` : ''}
    </div>

    <div class="aside__section">
      <div class="aside__section-title">LLM 配置</div>
      <div class="aside__field">
        <span class="aside__field-label">名称</span>
        <span class="aside__field-value">${llmConfig ? escapeHtml(llmConfig.name) : '已删除'}</span>
      </div>
      ${llmConfig ? `
        <div class="aside__field">
          <span class="aside__field-label">提供商</span>
          <span class="aside__field-value">${escapeHtml(llmConfig.provider)}</span>
        </div>
        <div class="aside__field">
          <span class="aside__field-label">模型</span>
          <span class="aside__field-value">${escapeHtml(llmConfig.model)}</span>
        </div>
      ` : ''}
    </div>

    <div class="aside__section">
      <div class="aside__section-title">统计</div>
      <div class="aside__field">
        <span class="aside__field-label">总消息数</span>
        <span class="aside__field-value">${msgCount}</span>
      </div>
      <div class="aside__field">
        <span class="aside__field-label">用户消息</span>
        <span class="aside__field-value">${userMessages}</span>
      </div>
      <div class="aside__field">
        <span class="aside__field-label">AI 回复</span>
        <span class="aside__field-value">${aiMessages}</span>
      </div>
    </div>

    ${conv.systemPrompt ? `
      <div class="aside__section">
        <div class="aside__section-title">系统提示词</div>
        <div class="aside__field aside__field--block">
          <span class="aside__field-value">${escapeHtml(conv.systemPrompt)}</span>
        </div>
      </div>
    ` : ''}

    <div class="aside__section" style="display: flex; flex-direction: column; gap: 8px;">
      <mdui-button variant="outlined" full-width id="aside-edit-btn">编辑对话</mdui-button>
      <mdui-button variant="text" full-width id="aside-clear-btn" style="color: rgb(var(--mdui-color-error));">清空消息</mdui-button>
    </div>
  `;

  // 绑定编辑按钮
  document.getElementById('aside-edit-btn')?.addEventListener('click', () => showEditConversationModal(conv));
  document.getElementById('aside-clear-btn')?.addEventListener('click', async () => {
    const ok = await confirm('确定要清空所有消息吗？此操作不可恢复。', '清空消息');
    if (!ok) return;
    try {
      await conversationApi.update(conv.id, { settings: { ...conv.settings, clearedAt: new Date().toISOString() } });
      await conversationApi.delete(conv.id);
      const newConv = await conversationApi.create({
        characterId: conv.characterId,
        llmConfigId: conv.llmConfigId,
        title: conv.title,
        systemPrompt: conv.systemPrompt,
        worldBookIds: conv.worldBookIds,
        settings: conv.settings,
      });
      showSuccess('已清空消息');
      await loadConversations();
      await selectConversation(newConv.id);
    } catch (err) {
      showError(err.message || '清空失败');
    }
  });
}

// ============ 折叠状态（mdui 抽屉） ============
function applySidebarState() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const collapsed = appState.get('sidebarCollapsed');
  // 确保组件已升级后再设置 open 属性
  const apply = () => {
    // 避免重复设置（防止与 close 事件形成循环）
    if (sidebar.open !== !collapsed) {
      sidebar.open = !collapsed;
    }
  };
  if (customElements.get('mdui-navigation-drawer')) {
    apply();
  } else {
    customElements.whenDefined('mdui-navigation-drawer').then(apply);
  }
}

function applyAsideState() {
  const aside = document.getElementById('aside');
  if (!aside) return;
  const collapsed = appState.get('asideCollapsed');
  const apply = () => {
    if (aside.open !== !collapsed) {
      aside.open = !collapsed;
    }
  };
  if (customElements.get('mdui-navigation-drawer')) {
    apply();
  } else {
    customElements.whenDefined('mdui-navigation-drawer').then(apply);
  }
}

/**
 * 同步抽屉的关闭事件到 appState（用户点击遮罩或按 ESC 关闭时）
 */
function syncDrawerCloseState() {
  const sidebar = document.getElementById('sidebar');
  const aside = document.getElementById('aside');
  // 当 drawer 通过 overlay/ESC 关闭时，同步 appState
  // 注意：mdui-select 等子组件的 close/closed 事件 composed:true bubbles:true 会冒泡到 drawer，
  // 需用 e.target 过滤掉来自子组件的冒泡事件，避免误关抽屉
  sidebar?.addEventListener('close', (e) => {
    if (e.target !== sidebar) return;
    if (appState.get('sidebarCollapsed') !== true) {
      appState.set('sidebarCollapsed', true);
    }
  });
  aside?.addEventListener('close', (e) => {
    if (e.target !== aside) return;
    if (appState.get('asideCollapsed') !== true) {
      appState.set('asideCollapsed', true);
    }
  });
}

// ============ 移动端侧栏 ============
function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  // 仅在窄屏关闭
  if (window.innerWidth < 840) {
    if (sidebar) sidebar.open = false;
  }
}

// ============ 创建对话模态框 ============
export async function showCreateConversationModal(presetCharacterId = null) {
  const characters = appState.get('characters');
  let llmConfigs = appState.get('llmConfigs');
  const worldbooks = appState.get('worldbooks') || [];

  if (!characters || characters.length === 0) {
    showError('请先创建角色卡');
    window.location.href = '/pages/characters.html';
    return;
  }
  if (!llmConfigs || llmConfigs.length === 0) {
    // 不跳转设置页，直接打开添加 LLM 配置对话框
    showInfo('请先添加 LLM 配置');
    const { showLlmForm } = await import('./settings.js');
    await showLlmForm(null);
    // 重新加载 LLM 配置到 appState
    const configs = await llmConfigApi.list();
    appState.set('llmConfigs', configs);
    if (!configs || configs.length === 0) {
      // 用户取消了添加，不继续
      return;
    }
    // 重新赋值 llmConfigs 变量
    llmConfigs = configs;
  }

  // 若指定了预设角色，则锁定为该角色
  let selectedCharacterId = presetCharacterId || characters[0].id;
  let selectedLlmConfigId = llmConfigs[0].id;
  // 初始化为所选角色卡绑定的世界书
  const presetChar = characters.find((c) => c.id === selectedCharacterId);
  let selectedWorldBookIds = [...(presetChar?.worldBookIds || [])];

  const characterGridHtml = characters.length > 0
    ? `<div class="mgmt-grid" style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));">${characters.map((c) => `
        <div class="character-tile character-card ${c.id === selectedCharacterId ? 'character-card--selected' : ''}" data-character-id="${c.id}" style="padding: 12px; cursor: pointer;">
          <div class="character-tile__header">
            <div class="character-tile__avatar" style="width: 36px; height: 36px; font-size: 16px;">
              ${c.avatar ? `<img src="${c.avatar}" alt="" />` : escapeHtml(c.name.charAt(0).toUpperCase())}
            </div>
            <div class="character-tile__info">
              <div class="character-tile__name" style="font-size: 13px;">${escapeHtml(c.name)}</div>
            </div>
          </div>
        </div>
      `).join('')}</div>`
    : `<div class="empty-state"><p class="empty-state__description">还没有角色卡，请先创建</p></div>`;

  const llmOptionsHtml = llmConfigs.map((c) => `
    <mdui-menu-item value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.provider)} / ${escapeHtml(c.model)})</mdui-menu-item>
  `).join('');

  const worldbookChipsHtml = worldbooks.length === 0
    ? `<div style="color: rgb(var(--mdui-color-on-surface-variant)); font-size: 13px;">暂无世界书</div>`
    : worldbooks.map((wb) => `
        <mdui-chip
          selectable
          ${selectedWorldBookIds.includes(wb.id) ? 'selected' : ''}
          data-wb-id="${wb.id}"
        >${escapeHtml(wb.name)}${wb.entryCount != null ? ` (${wb.entryCount})` : ''}</mdui-chip>
      `).join('');

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <label class="form-group__label">标题（可选）</label>
        <mdui-text-field id="conv-title" variant="outlined" placeholder="自动生成" style="width: 100%;"></mdui-text-field>
      </div>

      ${presetCharacterId ? '' : `
      <div class="form-group">
        <label class="form-group__label">选择角色卡</label>
        ${characterGridHtml}
      </div>
      `}

      <div class="form-group" id="conv-greeting-group" style="display: none;">
        <label class="form-group__label">开场白</label>
        <mdui-select id="conv-greeting" variant="outlined" style="width: 100%;"></mdui-select>
      </div>

      <div class="form-group">
        <label class="form-group__label">LLM 配置</label>
        <mdui-select id="conv-llm-config" value="${selectedLlmConfigId}" variant="outlined" style="width: 100%;">
          ${llmOptionsHtml}
        </mdui-select>
      </div>

      <div class="form-group">
        <label class="form-group__label">世界书（默认继承角色卡绑定，可调整）</label>
        <div class="char-wb-list" id="conv-wb-list">${worldbookChipsHtml}</div>
      </div>

      <div class="form-group">
        <label class="form-group__label">系统提示词（可选，覆盖角色卡默认）</label>
        <mdui-text-field id="conv-system-prompt" variant="outlined" rows="3" placeholder="留空则使用角色卡默认设置" style="width: 100%; --mdui-color-surface-container-highest: transparent;"></mdui-text-field>
      </div>
    </div>
  `;

  const result = await showModal({
    title: '创建新对话',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '创建', value: 'create', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      // 角色卡选择
      dialog.querySelectorAll('.character-card').forEach((card) => {
        card.addEventListener('click', () => {
          dialog.querySelectorAll('.character-card').forEach((c) => c.classList.remove('character-card--selected'));
          card.classList.add('character-card--selected');
          selectedCharacterId = card.dataset.characterId;
          // 切换角色卡时，自动继承该角色卡绑定的世界书
          const char = characters.find((c) => c.id === selectedCharacterId);
          selectedWorldBookIds = [...(char?.worldBookIds || [])];
          // 同步 UI
          dialog.querySelectorAll('#conv-wb-list mdui-chip').forEach((chip) => {
            const wbId = chip.dataset.wbId;
            if (selectedWorldBookIds.includes(wbId)) {
              chip.selected = true;
            } else {
              chip.selected = false;
            }
          });
          // 更新开场白选项
          updateGreetingOptions(selectedCharacterId);
        });
      });

      // 更新开场白选择器：根据角色卡的开场白数量动态显示/隐藏
      function updateGreetingOptions(charId) {
        const char = characters.find((c) => c.id === charId);
        const greetingGroup = dialog.querySelector('#conv-greeting-group');
        const greetingSelect = dialog.querySelector('#conv-greeting');
        if (!greetingGroup || !greetingSelect) return;

        const options = [];
        if (char?.firstMes) {
          const preview = char.firstMes.slice(0, 60).replace(/\n/g, ' ');
          options.push({ index: 0, label: `默认开场白: ${preview}${char.firstMes.length > 60 ? '...' : ''}` });
        }
        (char?.alternateGreetings || []).forEach((g, i) => {
          const preview = g.slice(0, 60).replace(/\n/g, ' ');
          options.push({ index: i + 1, label: `备选 ${i + 1}: ${preview}${g.length > 60 ? '...' : ''}` });
        });

        if (options.length > 1) {
          greetingGroup.style.display = '';
          // 先清空 value，再设置 menu items，最后延迟赋值
          // 否则 mdui-select 缓存了空菜单时的状态，不会刷新标签显示
          greetingSelect.value = '';
          greetingSelect.innerHTML = options.map((o) =>
            `<mdui-menu-item value="${o.index}">${escapeHtml(o.label)}</mdui-menu-item>`
          ).join('');
          setTimeout(() => {
            greetingSelect.value = '0';
          }, 0);
        } else {
          greetingGroup.style.display = 'none';
        }
      }

      // 初始化开场白选项
      updateGreetingOptions(selectedCharacterId);

      // 世界书 chip 切换
      dialog.querySelectorAll('#conv-wb-list mdui-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const wbId = chip.dataset.wbId;
          // 等待 mdui-chip 内部状态更新后读取
          requestAnimationFrame(() => {
            if (chip.selected) {
              if (!selectedWorldBookIds.includes(wbId)) selectedWorldBookIds.push(wbId);
            } else {
              selectedWorldBookIds = selectedWorldBookIds.filter((id) => id !== wbId);
            }
          });
        });
      });

      // LLM 配置变化
      dialog.querySelector('#conv-llm-config')?.addEventListener('change', (e) => {
        selectedLlmConfigId = e.target.value;
      });

      // 创建按钮
      dialog.querySelector('[data-action="create"]').addEventListener('click', async () => {
        const title = dialog.querySelector('#conv-title').value.trim();
        const systemPrompt = dialog.querySelector('#conv-system-prompt').value.trim();

        // 读取最新的 chip 选中状态（防止 requestAnimationFrame 未执行）
        selectedWorldBookIds = Array.from(dialog.querySelectorAll('#conv-wb-list mdui-chip[selected]')).map((chip) => chip.dataset.wbId);

        try {
          const greetingGroup = dialog.querySelector('#conv-greeting-group');
          const greetingIndex = greetingGroup && greetingGroup.style.display !== 'none'
            ? parseInt(dialog.querySelector('#conv-greeting').value, 10) || 0
            : 0;
          const newConv = await conversationApi.create({
            characterId: selectedCharacterId,
            llmConfigId: selectedLlmConfigId,
            title: title || undefined,
            systemPrompt: systemPrompt || undefined,
            worldBookIds: selectedWorldBookIds,
            greetingIndex,
            // 自动注入当前 Prompt Manager 的提示词列表（含 enabled 开关状态），
            // 这样默认预设的提示词在新建对话时即生效，无需手动点"应用到当前对话"
            settings: { prompts: getCurrentPrompts() },
          });
          showSuccess('对话已创建');
          close('created');
          await loadConversations();
          await selectConversation(newConv.id);
        } catch (err) {
          showError(err.message || '创建对话失败');
        }
      });
    },
  });
}

// ============ 编辑对话模态框 ============
async function showEditConversationModal(conv) {
  const llmConfigs = appState.get('llmConfigs');
  const llmOptionsHtml = llmConfigs.map((c) => `
    <mdui-menu-item value="${c.id}" ${c.id === conv.llmConfigId ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.provider)} / ${escapeHtml(c.model)})</mdui-menu-item>
  `).join('');

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <label class="form-group__label">标题</label>
        <mdui-text-field id="edit-title" variant="outlined" value="${escapeHtml(conv.title || '')}" style="width: 100%;"></mdui-text-field>
      </div>

      <div class="form-group">
        <label class="form-group__label">LLM 配置</label>
        <mdui-select id="edit-llm-config" value="${conv.llmConfigId}" variant="outlined" style="width: 100%;">
          ${llmOptionsHtml}
        </mdui-select>
      </div>

      <div class="form-group">
        <label class="form-group__label">系统提示词</label>
        <mdui-text-field id="edit-system-prompt" variant="outlined" rows="4" style="width: 100%;">${escapeHtml(conv.systemPrompt || '')}</mdui-text-field>
      </div>
    </div>
  `;

  await showModal({
    title: '编辑对话',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '保存', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const title = dialog.querySelector('#edit-title').value.trim();
        const llmConfigId = dialog.querySelector('#edit-llm-config').value;
        const systemPrompt = dialog.querySelector('#edit-system-prompt').value.trim();

        try {
          await conversationApi.update(conv.id, {
            title,
            llmConfigId,
            systemPrompt,
          });
          showSuccess('已保存');
          close('saved');
          await selectConversation(conv.id);
          await loadConversations();
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

// ============ 发送消息 ============
async function sendMessage() {
  const input = document.getElementById('message-input');
  let content = input.value.trim();
  if (!content || isGenerating) return;

  const conv = appState.get('currentConversation');
  if (!conv) {
    showError('请先选择对话');
    return;
  }

  // 应用正则脚本：用户输入替换（用户正则 + 预设正则）
  const regexScripts = getEffectiveRegexScripts();
  if (regexScripts.length > 0) {
    content = applyRegexScripts(content, regexScripts, {
      target: 'userInput',
      characterId: conv.characterId,
    });
  }

  // 清空输入
  input.value = '';

  // 立即在 UI 上显示用户消息
  const user = userState.getCurrentUser();
  const characters = appState.get('characters');
  const character = characters?.find((c) => c.id === conv.characterId);

  const userMsg = {
    id: 'temp-' + Date.now(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  };

  const messagesContainer = document.getElementById('chat-messages');
  const emptyEl = document.getElementById('chat-empty');
  if (emptyEl) emptyEl.style.display = 'none';
  messagesContainer.classList.remove('chat-messages--empty');

  if (messagesContainer.querySelector('.empty-state')) {
    messagesContainer.innerHTML = '';
  }

  messagesContainer.insertAdjacentHTML('beforeend', renderMessageHtml(userMsg, user, character));
  scrollToBottom();

  setGenerating(true);

  const aiMsgHtml = `
    <div class="message message--assistant" id="streaming-message">
      <div class="message__avatar">${character?.avatar ? `<img src="${character.avatar}" alt="" />` : escapeHtml(character?.name?.charAt(0).toUpperCase() || 'AI')}</div>
      <div class="message__content">
        <div id="streaming-thinking-container"></div>
        <div class="message__bubble message__bubble--streaming" id="streaming-bubble">
          <em style="color: rgb(var(--mdui-color-on-surface-variant));">正在思考...</em>
        </div>
        <div class="message__time">${formatTime(new Date().toISOString())}</div>
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', aiMsgHtml);
  scrollToBottom();

  const streamingBubble = document.getElementById('streaming-bubble');
  const thinkingContainer = document.getElementById('streaming-thinking-container');
  let fullContent = '';
  let fullThinking = '';
  let typingIndicatorRemoved = false;
  let doneReceived = false;

  const safeUpdateBubble = (html) => {
    if (streamingBubble && document.body.contains(streamingBubble)) {
      streamingBubble.innerHTML = html;
      if (userSettingsModule.getSettings().streamBlur !== false) {
        blurTrailingText(streamingBubble, 18);
      }
    }
  };
  const safeRemoveStreamingClass = () => {
    if (streamingBubble && document.body.contains(streamingBubble)) {
      streamingBubble.classList.remove('message__bubble--streaming');
      if (fullThinking) streamingBubble.classList.add('message__bubble--has-thinking');
    }
  };
  const safeUpdateThinking = () => {
    if (userSettingsModule.getSettings().showThinking === false) return;
    if (!thinkingContainer || !document.body.contains(thinkingContainer)) return;
    if (!fullThinking) return;
    // 增量更新：如果结构已存在，只更新 body 文本，避免重建 mdui-collapse
    const bodyEl = thinkingContainer.querySelector('.message__thinking-body');
    if (bodyEl) {
      bodyEl.textContent = fullThinking;
    } else {
      thinkingContainer.innerHTML = renderThinkingHtml(fullThinking, true);
      syncThinkingCollapseValue(thinkingContainer);
    }
  };
  const safeFinishThinking = () => {
    if (userSettingsModule.getSettings().showThinking === false) return;
    if (!thinkingContainer || !document.body.contains(thinkingContainer)) return;
    if (!fullThinking) return;
    // 根据用户设置决定是否展开思维链（默认收起）
    const userSettings = userSettingsModule.getSettings();
    const shouldExpand = userSettings.expandThinkingAfterComplete === true;
    thinkingContainer.innerHTML = renderThinkingHtml(fullThinking, false, !shouldExpand);
    syncThinkingCollapseValue(thinkingContainer);
  };

  try {
    currentAbortController = new AbortController();
    await conversationApi.sendMessage(conv.id, content, {
      onThinking: (chunk) => {
        fullThinking += chunk;
        if (!typingIndicatorRemoved) safeUpdateThinking();
        scrollToBottom();
      },
      onChunk: (chunk) => {
        if (!typingIndicatorRemoved) {
          safeUpdateBubble('');
          typingIndicatorRemoved = true;
          // 思考阶段结束（正文开始输出），立即收起思维链
          safeFinishThinking();
        }
        fullContent += chunk;
        safeUpdateBubble(renderMarkdown(fullContent));
        scrollToBottom();
      },
      onDone: () => {
        doneReceived = true;
        safeFinishThinking();
        safeRemoveStreamingClass();
        if (!typingIndicatorRemoved) {
          safeUpdateBubble(renderMarkdown(fullContent) || '<em>(空回复)</em>');
        }
        selectConversation(conv.id);
      },
      onMemoryGenerating: () => {
        setMemoryGenerating(true);
      },
      onMemoryDone: () => {
        setMemoryGenerating(false);
        // 刷新记忆 tab 数据（如果已渲染过）
        const memoryContent = document.getElementById('cp-content-memory');
        if (memoryContent && memoryContent.children.length > 0) {
          import('../controlPanel/memory.js').then(({ renderMemory }) => {
            renderMemory(memoryContent, { force: true });
          }).catch(() => {});
        }
      },
      onError: (err) => {
        doneReceived = true;
        safeFinishThinking();
        safeRemoveStreamingClass();
        // AbortError 不显示错误，仅清理 UI
        if (err.name === 'AbortError') {
          if (!fullContent) {
            safeUpdateBubble('<em style="color: rgb(var(--mdui-color-on-surface-variant));">已停止生成</em>');
          }
          return;
        }
        if (!fullContent) {
          safeUpdateBubble(`<em style="color: rgb(var(--mdui-color-error));">生成失败: ${escapeHtml(err.message)}</em>`);
        }
        showError(err.message || '生成失败');
      },
    }, currentAbortController.signal, getRegexExtraBody());
    // 流结束后确保思考状态终结（防止 done 事件未触发）
    safeFinishThinking();
  } catch (err) {
    safeFinishThinking();
    // AbortError 不显示错误 toast
    if (err.name !== 'AbortError') {
      if (!fullContent) {
        safeUpdateBubble(`<em style="color: rgb(var(--mdui-color-error));">生成失败: ${escapeHtml(err.message)}</em>`);
      }
      showError(err.message || '发送失败');
    }
  } finally {
    currentAbortController = null;
    setGenerating(false);
    // 确保记忆状态也被重置（防止 memory_done 事件未触发）
    if (isMemoryGenerating) setMemoryGenerating(false);
    const streamingMsg = document.getElementById('streaming-message');
    if (streamingMsg) streamingMsg.removeAttribute('id');
    const sb = document.getElementById('streaming-bubble');
    if (sb) sb.removeAttribute('id');
    const tc = document.getElementById('streaming-thinking-container');
    if (tc) tc.removeAttribute('id');
    // 中断/异常后延迟刷新消息列表（等待后端保存部分内容），恢复正常 ID 和 action buttons
    if (!doneReceived) {
      setTimeout(() => selectConversation(conv.id), 600);
    }
  }
}

// ============ 重新生成 ============
async function regenerateMessage() {
  const conv = appState.get('currentConversation');
  if (!conv || isGenerating) return;

  const messages = conv.messages || [];
  if (messages.length === 0) {
    showError('没有可重新生成的消息');
    return;
  }

  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== 'assistant') {
    showError('最后一条消息不是 AI 回复');
    return;
  }

  const messagesContainer = document.getElementById('chat-messages');
  const lastMsgEl = messagesContainer.querySelector(`[data-msg-id="${lastMsg.id}"]`);
  if (lastMsgEl) lastMsgEl.remove();

  setGenerating(true);

  const characters = appState.get('characters');
  const character = characters?.find((c) => c.id === conv.characterId);

  const aiMsgHtml = `
    <div class="message message--assistant" id="streaming-message">
      <div class="message__avatar">${character?.avatar ? `<img src="${character.avatar}" alt="" />` : escapeHtml(character?.name?.charAt(0).toUpperCase() || 'AI')}</div>
      <div class="message__content">
        <div id="streaming-thinking-container"></div>
        <div class="message__bubble message__bubble--streaming" id="streaming-bubble">
          <em style="color: rgb(var(--mdui-color-on-surface-variant));">正在思考...</em>
        </div>
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', aiMsgHtml);
  scrollToBottom();

  const streamingBubble = document.getElementById('streaming-bubble');
  const thinkingContainer = document.getElementById('streaming-thinking-container');
  let fullContent = '';
  let fullThinking = '';
  let typingIndicatorRemoved = false;
  let doneReceived = false;

  const safeUpdateBubble = (html) => {
    if (streamingBubble && document.body.contains(streamingBubble)) {
      streamingBubble.innerHTML = html;
      if (userSettingsModule.getSettings().streamBlur !== false) {
        blurTrailingText(streamingBubble, 18);
      }
    }
  };
  const safeRemoveStreamingClass = () => {
    if (streamingBubble && document.body.contains(streamingBubble)) {
      streamingBubble.classList.remove('message__bubble--streaming');
      if (fullThinking) streamingBubble.classList.add('message__bubble--has-thinking');
    }
  };
  const safeUpdateThinking = () => {
    if (userSettingsModule.getSettings().showThinking === false) return;
    if (!thinkingContainer || !document.body.contains(thinkingContainer)) return;
    if (!fullThinking) return;
    const bodyEl = thinkingContainer.querySelector('.message__thinking-body');
    if (bodyEl) {
      bodyEl.textContent = fullThinking;
    } else {
      thinkingContainer.innerHTML = renderThinkingHtml(fullThinking, true);
      syncThinkingCollapseValue(thinkingContainer);
    }
  };
  const safeFinishThinking = () => {
    if (userSettingsModule.getSettings().showThinking === false) return;
    if (!thinkingContainer || !document.body.contains(thinkingContainer)) return;
    if (!fullThinking) return;
    // 根据用户设置决定是否展开思维链（默认收起）
    const userSettings = userSettingsModule.getSettings();
    const shouldExpand = userSettings.expandThinkingAfterComplete === true;
    thinkingContainer.innerHTML = renderThinkingHtml(fullThinking, false, !shouldExpand);
    syncThinkingCollapseValue(thinkingContainer);
  };

  try {
    currentAbortController = new AbortController();
    await conversationApi.regenerate(conv.id, {
      onThinking: (chunk) => {
        fullThinking += chunk;
        if (!typingIndicatorRemoved) safeUpdateThinking();
        scrollToBottom();
      },
      onChunk: (chunk) => {
        if (!typingIndicatorRemoved) {
          safeUpdateBubble('');
          typingIndicatorRemoved = true;
          // 思考阶段结束（正文开始输出），立即收起思维链
          safeFinishThinking();
        }
        fullContent += chunk;
        safeUpdateBubble(renderMarkdown(fullContent));
        scrollToBottom();
      },
      onDone: () => {
        doneReceived = true;
        safeFinishThinking();
        safeRemoveStreamingClass();
        if (!typingIndicatorRemoved) {
          safeUpdateBubble(renderMarkdown(fullContent) || '<em>(空回复)</em>');
        }
        selectConversation(conv.id);
      },
      onMemoryGenerating: () => {
        setMemoryGenerating(true);
      },
      onMemoryDone: () => {
        setMemoryGenerating(false);
      },
      onError: (err) => {
        doneReceived = true;
        safeFinishThinking();
        safeRemoveStreamingClass();
        // AbortError 不显示错误，仅清理 UI
        if (err.name === 'AbortError') {
          if (!fullContent) {
            safeUpdateBubble('<em style="color: rgb(var(--mdui-color-on-surface-variant));">已停止生成</em>');
          }
          return;
        }
        safeUpdateBubble(`<em style="color: rgb(var(--mdui-color-error));">生成失败: ${escapeHtml(err.message)}</em>`);
        showError(err.message || '生成失败');
      },
    }, currentAbortController.signal, getRegexExtraBody());
    // 流结束后确保思考状态终结
    safeFinishThinking();
  } catch (err) {
    safeFinishThinking();
    if (err.name !== 'AbortError') {
      showError(err.message || '重新生成失败');
    }
  } finally {
    currentAbortController = null;
    setGenerating(false);
    if (isMemoryGenerating) setMemoryGenerating(false);
    const streamingMsg = document.getElementById('streaming-message');
    if (streamingMsg) streamingMsg.removeAttribute('id');
    const sb = document.getElementById('streaming-bubble');
    if (sb) sb.removeAttribute('id');
    const tc = document.getElementById('streaming-thinking-container');
    if (tc) tc.removeAttribute('id');
    // 中断/异常后延迟刷新消息列表
    if (!doneReceived) {
      setTimeout(() => selectConversation(conv.id), 600);
    }
  }
}

// ============ 续写功能 ============
async function continueLastMessage(conv, lastAssistantMsg) {
  if (!conv || !lastAssistantMsg) return;

  const messagesContainer = document.getElementById('chat-messages');
  const lastMsgEl = messagesContainer.querySelector(`[data-msg-id="${lastAssistantMsg.id}"]`);
  if (!lastMsgEl) {
    showError('找不到最后一条AI回复');
    return;
  }

  setGenerating(true);

  // 就地复用原消息节点进行续写，避免新增楼层
  const contentEl = lastMsgEl.querySelector('.message__content');
  // 移除原有思维链（续写会生成新的思维链）
  contentEl.querySelectorAll('.message__thinking').forEach((el) => el.remove());
  // 找到原 bubble 并就地改造为流式状态
  const streamingBubble = contentEl.querySelector('.message__bubble');
  streamingBubble.id = 'streaming-bubble';
  streamingBubble.classList.add('message__bubble--streaming');
  streamingBubble.innerHTML = '<em style="color: rgb(var(--mdui-color-on-surface-variant));">正在续写...</em>';
  // 插入新的思维链容器（位于 bubble 之前）
  const thinkingContainer = document.createElement('div');
  thinkingContainer.id = 'streaming-thinking-container';
  contentEl.insertBefore(thinkingContainer, streamingBubble);
  scrollToBottom();
  let fullContent = lastAssistantMsg.content || '';
  let fullThinking = '';
  let typingIndicatorRemoved = false;
  let doneReceived = false;

  const safeUpdateBubble = (html) => {
    if (streamingBubble && document.body.contains(streamingBubble)) {
      streamingBubble.innerHTML = html;
      if (userSettingsModule.getSettings().streamBlur !== false) {
        blurTrailingText(streamingBubble, 18);
      }
    }
  };
  const safeRemoveStreamingClass = () => {
    if (streamingBubble && document.body.contains(streamingBubble)) {
      streamingBubble.classList.remove('message__bubble--streaming');
      if (fullThinking) streamingBubble.classList.add('message__bubble--has-thinking');
    }
  };
  const safeUpdateThinking = () => {
    if (userSettingsModule.getSettings().showThinking === false) return;
    if (!thinkingContainer || !document.body.contains(thinkingContainer)) return;
    if (!fullThinking) return;
    const bodyEl = thinkingContainer.querySelector('.message__thinking-body');
    if (bodyEl) {
      bodyEl.textContent = fullThinking;
    } else {
      thinkingContainer.innerHTML = renderThinkingHtml(fullThinking, true);
      syncThinkingCollapseValue(thinkingContainer);
    }
  };
  const safeFinishThinking = () => {
    if (userSettingsModule.getSettings().showThinking === false) return;
    if (!thinkingContainer || !document.body.contains(thinkingContainer)) return;
    if (!fullThinking) return;
    // 根据用户设置决定是否展开思维链（默认收起）
    const userSettings = userSettingsModule.getSettings();
    const shouldExpand = userSettings.expandThinkingAfterComplete === true;
    thinkingContainer.innerHTML = renderThinkingHtml(fullThinking, false, !shouldExpand);
    syncThinkingCollapseValue(thinkingContainer);
  };

  try {
    currentAbortController = new AbortController();
    // 使用 continue API，它会在原有内容基础上继续生成
    await conversationApi.continue(conv.id, {
      onThinking: (chunk) => {
        fullThinking += chunk;
        if (!typingIndicatorRemoved) safeUpdateThinking();
        scrollToBottom();
      },
      onChunk: (chunk) => {
        if (!typingIndicatorRemoved) {
          safeUpdateBubble('');
          typingIndicatorRemoved = true;
          // 思考阶段结束（正文开始输出），立即收起思维链
          safeFinishThinking();
        }
        fullContent += chunk;
        safeUpdateBubble(renderMarkdown(fullContent));
        scrollToBottom();
      },
      onDone: () => {
        doneReceived = true;
        safeFinishThinking();
        safeRemoveStreamingClass();
        if (!typingIndicatorRemoved) {
          safeUpdateBubble(renderMarkdown(fullContent) || '<em>(空回复)</em>');
        }
        selectConversation(conv.id);
      },
      onMemoryGenerating: () => {
        setMemoryGenerating(true);
      },
      onMemoryDone: () => {
        setMemoryGenerating(false);
      },
      onError: (err) => {
        doneReceived = true;
        safeFinishThinking();
        safeRemoveStreamingClass();
        if (err.name === 'AbortError') {
          if (!fullContent) {
            safeUpdateBubble('<em style="color: rgb(var(--mdui-color-on-surface-variant));">已停止续写</em>');
          }
          return;
        }
        safeUpdateBubble(`<em style="color: rgb(var(--mdui-color-error));">续写失败: ${escapeHtml(err.message)}</em>`);
        showError(err.message || '续写失败');
      },
    }, currentAbortController.signal, getRegexExtraBody());
    // 流结束后确保思考状态终结
    safeFinishThinking();
  } catch (err) {
    safeFinishThinking();
    if (err.name !== 'AbortError') {
      showError(err.message || '续写失败');
    }
  } finally {
    currentAbortController = null;
    setGenerating(false);
    if (isMemoryGenerating) setMemoryGenerating(false);
    const streamingMsg = document.getElementById('streaming-message');
    if (streamingMsg) streamingMsg.removeAttribute('id');
    const sb = document.getElementById('streaming-bubble');
    if (sb) sb.removeAttribute('id');
    const tc = document.getElementById('streaming-thinking-container');
    if (tc) tc.removeAttribute('id');
    // 中断/异常后延迟刷新消息列表
    if (!doneReceived) {
      setTimeout(() => selectConversation(conv.id), 600);
    }
  }
}

// ============ AI帮答功能 ============
async function aiHelpReply(conv, lastAssistantMsg) {
  if (!conv || !lastAssistantMsg) return;

  const input = document.getElementById('message-input');
  if (!input) return;

  // 保存原始内容，便于失败时恢复
  const originalValue = input.value;
  input.value = '';
  input.placeholder = 'AI 正在根据角色的回复生成建议...';
  setGenerating(true);
  updateSendBtnState();

  let fullContent = '';

  try {
    currentAbortController = new AbortController();
    await conversationApi.aiHelp(conv.id, {
      onChunk: (chunk) => {
        fullContent += chunk;
        input.value = fullContent;
        updateSendBtnState();
      },
      onDone: () => {
        input.value = fullContent || '';
        if (fullContent) {
          showSuccess('已生成回复建议，请确认后发送');
        } else {
          showInfo('未生成有效内容');
        }
      },
      onError: (err) => {
        if (err.name === 'AbortError') return;
        showError(err.message || 'AI 帮答失败');
      },
    }, currentAbortController.signal);
  } catch (err) {
    if (err.name !== 'AbortError') {
      showError(err.message || 'AI 帮答失败');
    }
  } finally {
    currentAbortController = null;
    setGenerating(false);
    input.placeholder = '';
    // 中断或失败时若没有内容，恢复原始输入
    if (!input.value && originalValue) input.value = originalValue;
    input.focus();
    updateSendBtnState();
  }
}

// ============ 生成状态切换 ============
function setGenerating(loading) {
  isGenerating = loading;
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  const input = document.getElementById('message-input');

  if (loading) {
    sendBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    input.disabled = false;
  } else {
    sendBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  }
  updateSendBtnState();
}

function updateSendBtnState() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.disabled = isGenerating || isMemoryGenerating || !input.value.trim();
}

// ============ 强制修改密码 ============
async function showForcePasswordDialog() {
  const result = await showModal({
    title: '请修改初始密码',
    content: `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="font-size: 13px; color: var(--mdui-color-on-surface-variant); padding: 8px 12px; background: rgb(var(--mdui-color-surface-container, 243 237 247)); border-radius: 8px;">
          您使用的是管理员分配的默认密码（Abc123456），为了账号安全请设置新密码后才能使用系统。
        </div>
        <mdui-text-field variant="outlined" id="force-new-password" type="password" label="新密码"
          helper="至少 8 位，包含大小写字母和数字" autocomplete="new-password"></mdui-text-field>
        <mdui-text-field variant="outlined" id="force-confirm-password" type="password" label="确认密码"
          autocomplete="new-password"></mdui-text-field>
      </div>
    `,
    actions: [
      { text: '退出登录', value: 'logout', type: 'text' },
      { text: '确认修改', value: 'confirm', type: 'filled' },
    ],
    closeOnOverlay: false,
    onMount: (dialog, close) => {
      const confirmBtn = dialog.querySelector('[data-action="confirm"]');
      const cloned = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(cloned, confirmBtn);
      cloned.addEventListener('click', async () => {
        const newPwd = dialog.querySelector('#force-new-password').value;
        const confirmPwd = dialog.querySelector('#force-confirm-password').value;

        if (!newPwd || newPwd.length < 8) {
          showError('密码至少 8 位');
          return;
        }
        if (!/[a-z]/.test(newPwd) || !/[A-Z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
          showError('密码需包含大小写字母和数字');
          return;
        }
        if (newPwd !== confirmPwd) {
          showError('两次输入的密码不一致');
          return;
        }

        cloned.loading = true;
        cloned.disabled = true;
        try {
          await authApi.forcePassword(newPwd);
          showSuccess('密码修改成功，欢迎使用 SmartTavern');
          close('changed');
        } catch (err) {
          cloned.loading = false;
          cloned.disabled = false;
          showError(err.message || '修改失败');
        }
      });

      // 退出登录按钮
      const logoutBtn = dialog.querySelector('[data-action="logout"]');
      const logoutCloned = logoutBtn.cloneNode(true);
      logoutBtn.parentNode.replaceChild(logoutCloned, logoutBtn);
      logoutCloned.addEventListener('click', () => close('logout'));
    },
  });

  return result === 'changed';
}

// ============ 记忆总结状态 ============

function setMemoryGenerating(generating) {
  isMemoryGenerating = generating;
  const input = document.getElementById('message-input');
  const memoryStatus = document.getElementById('memory-status');

  if (generating) {
    if (input) input.disabled = true;
    if (memoryStatus) memoryStatus.style.display = 'flex';
  } else {
    if (input) input.disabled = false;
    if (memoryStatus) memoryStatus.style.display = 'none';
  }
  updateSendBtnState();
}

// ============ 用户菜单下拉（使用 mdui-dropdown + mdui-menu） ============
function setupUserMenu() {
  const userInfo = document.getElementById('user-info');
  const userMenuBtn = document.getElementById('user-menu-btn');

  if (userMenuBtn) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const user = userState.getCurrentUser();
      const isAdmin = user?.role === 'admin';

      // 创建 dropdown
      const dropdown = document.createElement('mdui-dropdown');
      dropdown.setAttribute('open', '');

      const trigger = document.createElement('mdui-button-icon');
      trigger.setAttribute('slot', 'trigger');
      trigger.setAttribute('icon', 'more_vert');
      dropdown.appendChild(trigger);

      const menu = document.createElement('mdui-menu');
      menu.innerHTML = `
        <mdui-menu-item href="/pages/characters.html" icon="account_box">角色卡管理</mdui-menu-item>
        <mdui-menu-item href="/pages/worldbooks.html" icon="menu_book">世界书管理</mdui-menu-item>
        <mdui-menu-item href="/pages/settings.html" icon="settings">设置</mdui-menu-item>
        ${isAdmin ? `<mdui-divider></mdui-divider><mdui-menu-item href="/pages/settings.html#users" icon="manage_accounts">用户管理</mdui-menu-item>` : ''}
        <mdui-divider></mdui-divider>
        <mdui-menu-item id="logout-menu-item" icon="logout" style="color: rgb(var(--mdui-color-error));">退出登录</mdui-menu-item>
      `;
      dropdown.appendChild(menu);

      // 替换原按钮位置
      userMenuBtn.parentElement.appendChild(dropdown);
      dropdown.style.position = 'absolute';
      dropdown.style.visibility = 'hidden';

      // 直接使用 mdui-menu 弹出
      dropdown.remove();

      // 简化方案：用 mdui.menu() 函数弹出
      if (window.mdui && typeof window.mdui.menu === 'function') {
        window.mdui.menu({
          trigger: userMenuBtn,
          position: 'top-end',
          menus: [
            { text: '角色卡管理', icon: 'account_box', href: '/pages/characters.html' },
            { text: '世界书管理', icon: 'menu_book', href: '/pages/worldbooks.html' },
            { text: '设置', icon: 'settings', href: '/pages/settings.html' },
            ...(isAdmin ? [{ divider: true }, { text: '用户管理', icon: 'manage_accounts', href: '/pages/settings.html#users' }] : []),
            { divider: true },
            { text: '退出登录', icon: 'logout', onclick: async () => {
              const ok = await confirm('确定要退出登录吗？', '退出登录');
              if (!ok) return;
              await userState.logout();
            }, style: { color: 'rgb(var(--mdui-color-error))' } },
          ],
        });
      } else {
        // 兜底：跳转到设置页
        window.location.href = '/pages/settings.html';
      }
    });
  }
}

// ============ 绑定事件 ============
function bindEvents() {
  // 切换侧边栏（开/关，桌面+移动端通用）
  document.getElementById('toggle-sidebar')?.addEventListener('click', () => {
    appState.set('sidebarCollapsed', !appState.get('sidebarCollapsed'));
  });

  // 折叠右侧栏
  document.getElementById('toggle-aside')?.addEventListener('click', () => {
    appState.set('asideCollapsed', !appState.get('asideCollapsed'));
  });

  // 关闭右侧栏
  document.getElementById('close-aside')?.addEventListener('click', () => {
    appState.set('asideCollapsed', true);
  });

  // 新对话（空状态按钮，侧栏已移除新对话入口）
  document.getElementById('empty-new-conv')?.addEventListener('click', () => showCreateConversationModal());

  // 输入框
  const messageInput = document.getElementById('message-input');
  messageInput?.addEventListener('input', () => {
    updateSendBtnState();
  });
  messageInput?.addEventListener('keydown', (e) => {
    const userSettings = appState.get('userSettings') || {};
    if (e.key === 'Enter') {
      if (userSettings.sendOnEnter !== false) {
        // Enter 发送（Shift+Enter 换行）
        if (!e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      } else {
        // Ctrl+Enter 发送
        if (e.ctrlKey) {
          e.preventDefault();
          sendMessage();
        }
      }
    }
  });

  // 发送 / 停止
  document.getElementById('send-btn')?.addEventListener('click', sendMessage);
  document.getElementById('stop-btn')?.addEventListener('click', () => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    setGenerating(false);
    showInfo('已停止生成');
  });

  // 对话更多操作（续写、AI帮答）
  document.getElementById('conv-settings-btn')?.addEventListener('click', (e) => {
    const conv = appState.get('currentConversation');
    if (!conv) return;

    const messages = conv.messages || [];
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
    
    if (!lastAssistantMsg) {
      showError('没有AI回复，无法续写或帮答');
      return;
    }

    const btn = e.currentTarget;
    const menu = document.createElement('mdui-menu');
    menu.setAttribute('style', 'position: fixed; z-index: 9999;');
    
    // 续写选项
    const continueItem = document.createElement('mdui-menu-item');
    continueItem.textContent = '续写';
    continueItem.setAttribute('icon', 'edit_note');
    continueItem.addEventListener('click', async () => {
      document.body.removeChild(menu);
      await continueLastMessage(conv, lastAssistantMsg);
    });
    menu.appendChild(continueItem);

    // AI帮答选项
    const helpReplyItem = document.createElement('mdui-menu-item');
    helpReplyItem.textContent = 'AI帮答';
    helpReplyItem.setAttribute('icon', 'auto_awesome');
    helpReplyItem.addEventListener('click', async () => {
      document.body.removeChild(menu);
      await aiHelpReply(conv, lastAssistantMsg);
    });
    menu.appendChild(helpReplyItem);

    // 定位菜单（朝上打开，避免被页面底部截断）
    const rect = btn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    
    document.body.appendChild(menu);
    
    // 点击外部关闭菜单
    setTimeout(() => {
      const closeMenu = (e) => {
        if (!menu.contains(e.target) && e.target !== btn) {
          if (document.body.contains(menu)) {
            document.body.removeChild(menu);
          }
          document.removeEventListener('click', closeMenu);
        }
      };
      document.addEventListener('click', closeMenu);
    }, 0);
  });

  // 用户菜单
  setupUserMenu();

  // 主题切换（Ctrl+S）
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'MDUI-TEXT-FIELD') return;
    if (e.key === 's' && e.ctrlKey) {
      e.preventDefault();
      themeState.toggleTheme();
    }
  });
}

// ============ 快速回复 ============
function renderQuickReplies() {
  const bar = document.getElementById('quick-reply-bar');
  if (!bar) return;

  // 检查扩展是否启用
  const extState = storage.get('cp_extensions', {});
  const extSettings = storage.get('cp_extension_settings', {});
  if (!extState['quick-reply']) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  const qrSettings = extSettings['quick-reply'] || {};
  const replies = qrSettings.replies || [];
  if (replies.length === 0) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  const autoSend = qrSettings.autoSend === true;
  bar.style.display = 'flex';
  bar.innerHTML = replies.map((r, i) =>
    '<button class="quick-reply-chip" data-idx="' + i + '">' + escapeHtml(r.label || r.message) + '</button>'
  ).join('');

  bar.querySelectorAll('.quick-reply-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const idx = parseInt(chip.dataset.idx, 10);
      const reply = replies[idx];
      if (!reply) return;
      const input = document.getElementById('message-input');
      if (!input) return;
      input.value = reply.message;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (autoSend) {
        sendMessage();
      } else {
        input.focus();
      }
    });
  });
}

// ============ 启动 ============
init();
