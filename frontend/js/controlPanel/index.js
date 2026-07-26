/**
 * 顶部控制面板主入口
 * 参考 SillyTavern 的 drawer 设计，采用标签页式布局
 */
import appState from '../stores/appState.js';
import { renderApiConnection } from './apiConnection.js';
import { renderWorldInfo } from './worldInfo.js';
import { renderUserSettings } from './userSettings.js';
import { renderExtensions } from './extensions.js';
import { renderPersonas } from './personas.js';
import { renderCharacters } from './characters.js';
import { renderMemory } from './memory.js';
import { renderCache } from './cache.js';
import { renderRegex } from './regex.js';

// ============ Tab 配置 ============
// title/icon 用于展开面板顶部的功能标题（tab 栏仅显示图标）
const TABS = [
  { id: 'api-connection', title: 'API 连接', icon: 'power', renderer: renderApiConnection },
  { id: 'world-info', title: '世界信息', icon: 'menu_book', renderer: renderWorldInfo },
  { id: 'user-settings', title: '用户设置', icon: 'manage_accounts', renderer: renderUserSettings },
  { id: 'extensions', title: '扩展', icon: 'extension', renderer: renderExtensions },
  { id: 'personas', title: '个性', icon: 'face', renderer: renderPersonas },
  { id: 'characters', title: '角色', icon: 'person', renderer: renderCharacters },
  { id: 'memory', title: '记忆', icon: 'psychology', renderer: renderMemory },
  { id: 'cache', title: '缓存', icon: 'bolt', renderer: renderCache },
  { id: 'regex', title: '正则', icon: 'find_replace', renderer: renderRegex },
];

let activeTab = null;
let initialized = false;
// 记录已渲染过的 tab，避免重复渲染（除非显式刷新）
const renderedTabs = new Set();

// ============ 初始化 ============
function init() {
  if (initialized) return;
  initialized = true;

  const tabsEl = document.getElementById('control-panel-tabs');

  // 监听 mdui-tab 的 click 事件（而非 tabs 的 change 事件）
  // 这样可以在点击已激活的 tab 时触发收起
  tabsEl?.querySelectorAll('mdui-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabId = tab.value;
      toggleTab(tabId);
    });
  });
}

// ============ 切换 Tab ============
function toggleTab(tabId) {
  const panel = document.getElementById('control-panel');
  const tabsEl = document.getElementById('control-panel-tabs');

  // 如果点击的是当前激活的 Tab，则收起面板
  if (activeTab === tabId && panel.classList.contains('control-panel--expanded')) {
    collapse();
    return;
  }

  // 展开
  panel.classList.add('control-panel--expanded');
  activeTab = tabId;

  // 同步 mdui-tabs 的激活状态
  if (tabsEl) tabsEl.value = tabId;

  // 切换 body 显示
  document.querySelectorAll('.control-panel__body').forEach((body) => {
    body.classList.remove('control-panel__body--active');
  });
  const targetBody = document.getElementById(`cp-body-${tabId}`);
  if (targetBody) {
    targetBody.classList.add('control-panel__body--active');
    // 面板顶部插入功能标题（tab 栏只显示图标，标题在这里展示）
    const tabConfig = TABS.find((t) => t.id === tabId);
    if (tabConfig?.title && !targetBody.querySelector('.control-panel__title')) {
      const titleEl = document.createElement('div');
      titleEl.className = 'control-panel__title';
      titleEl.innerHTML = `<mdui-icon name="${tabConfig.icon}"></mdui-icon>${tabConfig.title}`;
      targetBody.prepend(titleEl);
    }
  }

  // 渲染内容
  renderTabContent(tabId);
}

// ============ 渲染 Tab 内容 ============
function renderTabContent(tabId) {
  const contentEl = document.getElementById(`cp-content-${tabId}`);
  if (!contentEl) return;

  const tabConfig = TABS.find((t) => t.id === tabId);
  if (!tabConfig) return;

  try {
    tabConfig.renderer(contentEl, { force: !renderedTabs.has(tabId) });
    renderedTabs.add(tabId);
  } catch (err) {
    console.error(`渲染 Tab "${tabId}" 失败:`, err);
    contentEl.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty__title">模块加载失败</div>
        <div class="cp-empty__desc">${err.message || String(err)}</div>
      </div>
    `;
  }
}

// ============ 收起面板 ============
function collapse() {
  const panel = document.getElementById('control-panel');
  const tabsEl = document.getElementById('control-panel-tabs');
  panel.classList.remove('control-panel--expanded');
  // 重置 mdui-tabs 的激活状态
  if (tabsEl) tabsEl.value = '';
  document.querySelectorAll('.control-panel__body').forEach((b) => {
    b.classList.remove('control-panel__body--active');
  });
  activeTab = null;
}

// ============ 打开指定 Tab ============
function openTab(tabId) {
  if (activeTab === tabId) return;
  toggleTab(tabId);
}

// ============ 刷新指定 Tab ============
function refresh(tabId) {
  renderedTabs.delete(tabId);
  if (activeTab === tabId) {
    renderTabContent(tabId);
  }
}

// ============ 刷新所有 Tab ============
function refreshAll() {
  renderedTabs.clear();
  if (activeTab) {
    renderTabContent(activeTab);
  }
}

export default {
  init,
  toggleTab,
  openTab,
  collapse,
  refresh,
  refreshAll,
  get activeTab() {
    return activeTab;
  },
};
