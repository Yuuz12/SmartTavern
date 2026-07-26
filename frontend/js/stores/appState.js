/**
 * 应用状态管理
 * 简单的发布订阅模式
 */
import storage from '../utils/storage.js';

class AppState {
  constructor() {
    this.state = {
      user: null,
      conversations: [],
      currentConversation: null,
      characters: [],
      worldbooks: [],
      llmConfigs: [],
      sidebarCollapsed: storage.get('sidebarCollapsed', false),
      asideCollapsed: storage.get('asideCollapsed', false),
      theme: storage.get('theme', 'system'),
      /** 用户设置（字体/消息显示/交互等，实时生效）
       * 默认值由 controlPanel/userSettings.js 的 DEFAULT_SETTINGS 统一提供（getSettings 合并），
       * 这里不再重复维护一份默认值副本，避免两处不一致 */
      userSettings: storage.get('cp_user_settings', {}),
      loading: false,
    };
    this.listeners = new Map();
  }

  /**
   * 获取状态
   */
  get(key) {
    return key ? this.state[key] : this.state;
  }

  /**
   * 设置状态
   */
  set(key, value) {
    const oldValue = this.state[key];

    // 相等性检查：值未变化时不通知，避免订阅者与设置者之间形成递归
    if (oldValue === value) return;

    // 递归深度保护：防止订阅者再次调用 set 形成无限递归
    this._setDepth = (this._setDepth || 0) + 1;
    if (this._setDepth > 3) {
      console.warn('[appState] recursion depth exceeded for key:', key, 'depth:', this._setDepth);
      this._setDepth--;
      return;
    }

    this.state[key] = value;

    // 持久化部分状态
    if (['sidebarCollapsed', 'asideCollapsed', 'theme', 'userSettings'].includes(key)) {
      storage.set(key === 'userSettings' ? 'cp_user_settings' : key, value);
    }

    this.notify(key, value, oldValue);

    this._setDepth--;
  }

  /**
   * 订阅状态变化
   */
  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);

    // 返回取消订阅函数
    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  /**
   * 通知监听器
   */
  notify(key, newValue, oldValue) {
    const listeners = this.listeners.get(key);
    if (listeners) {
      listeners.forEach((cb) => {
        try {
          cb(newValue, oldValue);
        } catch (err) {
          console.error('[appState] listener error for key:', key, 'error:', err.message);
        }
      });
    }
    // 通知全局监听器
    const globalListeners = this.listeners.get('*');
    if (globalListeners) {
      globalListeners.forEach((cb) => {
        try {
          cb(key, newValue, oldValue);
        } catch (err) {
          console.error('[appState] global listener error:', err.message);
        }
      });
    }
  }

  /**
   * 批量更新
   */
  batch(updates) {
    Object.entries(updates).forEach(([key, value]) => {
      this.set(key, value);
    });
  }

  /**
   * 重置状态
   */
  reset() {
    this.state = {
      user: null,
      conversations: [],
      currentConversation: null,
      characters: [],
      worldbooks: [],
      llmConfigs: [],
      sidebarCollapsed: false,
      asideCollapsed: false,
      theme: 'system',
      loading: false,
    };
  }
}

export const appState = new AppState();
export default appState;
