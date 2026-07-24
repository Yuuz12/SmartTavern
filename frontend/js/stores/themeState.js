/**
 * 主题状态管理
 */
import appState from './appState.js';
import storage from '../utils/storage.js';

class ThemeState {
  constructor() {
    this.themes = [
      { id: 'system', name: '跟随系统', icon: 'auto' },
      { id: 'light', name: '浅色', icon: 'light' },
      { id: 'dark', name: '暗色', icon: 'dark' },
    ];
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  }

  /**
   * 初始化主题
   */
  init() {
    const savedTheme = storage.get('theme', 'system');
    this.applyTheme(savedTheme);

    // 监听系统主题变化
    this.mediaQuery.addEventListener('change', () => {
      if (appState.get('theme') === 'system') {
        this.applySystemTheme();
      }
    });
  }

  /**
   * 应用主题
   */
  applyTheme(theme) {
    appState.set('theme', theme);
    storage.set('theme', theme);

    if (theme === 'system') {
      this.applySystemTheme();
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  /**
   * 应用系统主题
   */
  applySystemTheme() {
    const isDark = this.mediaQuery.matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  /**
   * 切换主题
   */
  toggleTheme() {
    const current = appState.get('theme');
    const next = current === 'dark' ? 'light' : 'dark';
    this.applyTheme(next);
  }

  /**
   * 设置主题（applyTheme 的别名，兼容控制面板调用）
   */
  setTheme(theme) {
    this.applyTheme(theme);
  }

  /**
   * 获取当前主题
   */
  getCurrentTheme() {
    return appState.get('theme');
  }

  /**
   * 获取可用主题列表
   */
  getThemes() {
    return this.themes;
  }
}

export const themeState = new ThemeState();
export default themeState;
