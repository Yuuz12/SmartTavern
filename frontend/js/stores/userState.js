/**
 * 用户状态管理
 */
import appState from './appState.js';
import { authApi } from '../api/index.js';
import { getAccessToken, clearTokens, setTokens } from '../utils/request.js';

class UserState {
  /**
   * 初始化 - 检查登录状态
   */
  async init() {
    if (!getAccessToken()) {
      return null;
    }
    try {
      const user = await authApi.me();
      appState.set('user', user);
      return user;
    } catch (err) {
      clearTokens();
      return null;
    }
  }

  /**
   * 登录
   */
  async login(username, password) {
    const data = await authApi.login(username, password);
    setTokens(data.accessToken, data.refreshToken);
    appState.set('user', data);
    return data;
  }

  /**
   * 注册
   */
  async register(username, password) {
    const data = await authApi.register(username, password);
    setTokens(data.accessToken, data.refreshToken);
    appState.set('user', data);
    return data;
  }

  /**
   * 登出
   */
  async logout() {
    try {
      await authApi.logout();
    } catch {
      // 忽略错误
    }
    clearTokens();
    appState.set('user', null);
    appState.set('currentConversation', null);
    window.location.href = '/login';
  }

  /**
   * 获取当前用户
   */
  getCurrentUser() {
    return appState.get('user');
  }

  /**
   * 是否已登录
   */
  isLoggedIn() {
    return !!appState.get('user');
  }

  /**
   * 是否是管理员
   */
  isAdmin() {
    const user = appState.get('user');
    return user?.role === 'admin';
  }

  /**
   * 更新用户信息
   */
  updateUser(updates) {
    const user = { ...appState.get('user'), ...updates };
    appState.set('user', user);
  }
}

export const userState = new UserState();
export default userState;
