/**
 * mdui 主题初始化
 * 负责配置 mdui 的颜色方案、暗色模式，并桥接 themeState
 */
import { setColorScheme, setTheme } from '../../lib/mdui/mdui.esm.js';
import appState from '../stores/appState.js';
import storage from './storage.js';

// SmartTavern 品牌主色（保持与原 variables.css 一致的紫色）
const BRAND_PRIMARY = '#6750A4';

/**
 * 初始化 mdui 主题
 */
export function initMduiTheme() {
  const savedTheme = storage.get('theme', 'system');
  applyMduiTheme(savedTheme);

  // 监听系统主题变化
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (appState.get('theme') === 'system') {
      applyMduiTheme('system');
    }
  });

  // 订阅主题状态变化
  appState.subscribe('theme', (theme) => {
    applyMduiTheme(theme);
  });
}

/**
 * 应用 mdui 主题
 * 注意：本函数只负责将主题应用到 DOM/mdui，不再调用 appState.set
 * 因为本函数通常作为 appState 的订阅者被触发，此时 appState.state.theme 已经是最新值
 * 如果需要更新 appState 中的主题，请直接调用 appState.set('theme', ...) 或 themeState.applyTheme(...)
 */
export function applyMduiTheme(theme) {
  if (!theme) return;

  // 持久化（幂等操作，重复调用安全）
  storage.set('theme', theme);

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // 设置 mdui 颜色方案（仅需设置一次，自动生成 MD3 调色板）+ 切换暗色模式
  try {
    setColorScheme(BRAND_PRIMARY, { target: document.documentElement });
    setTheme(isDark ? 'dark' : 'light', document.documentElement);
  } catch (err) {
    // 兜底：直接设置 mdui 的暗色模式属性
    document.documentElement.classList.toggle('mdui-theme-dark', isDark);
  }

  // 同时设置 data-theme 属性，兼容旧 CSS 变量（variables.css）
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  // 设置 color-scheme 让浏览器原生控件（滚动条等）适配
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

/**
 * 切换主题（在 light / dark 之间切换）
 */
export function toggleMduiTheme() {
  const current = appState.get('theme') || 'system';
  const next = current === 'dark' ? 'light' : 'dark';
  applyMduiTheme(next);
}

export default { initMduiTheme, applyMduiTheme, toggleMduiTheme };
