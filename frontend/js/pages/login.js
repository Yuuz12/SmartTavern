/**
 * 登录/注册页逻辑
 */
import { userState } from '../stores/userState.js';
import { themeState } from '../stores/themeState.js';
import appState from '../stores/appState.js';
import { showToast, showError, showInfo } from '../components/Toast.js';
import { initMduiTheme } from '../utils/mduiTheme.js';
import { getAccessToken } from '../utils/request.js';
import { systemApi } from '../api/index.js';

initMduiTheme();
themeState.init();

// ============ 已登录则跳转 ============
if (getAccessToken()) {
  userState.init()
    .then((user) => {
      if (user) window.location.replace('/pages/chat.html');
    })
    .catch(() => {});
}

// ============ 检查注册开关 ============
systemApi.getRegistration()
  .then((data) => {
    if (!data.registrationEnabled) {
      document.querySelector('mdui-tab[value="register"]')?.remove();
      document.querySelector('mdui-tab-panel[value="register"]')?.remove();
    }
  })
  .catch(() => {});

// ============ 标签切换（使用 mdui-tabs） ============
const tabsEl = document.querySelector('.auth-tabs');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

// mdui-tabs 的 change 事件（需过滤 mdui-text-field 等子组件冒泡的 change 事件）
tabsEl?.addEventListener('change', (e) => {
  if (e.target !== tabsEl) return;
  const value = tabsEl.value;
  loginForm.style.display = value === 'login' ? 'flex' : 'none';
  registerForm.style.display = value === 'register' ? 'flex' : 'none';
});

// 初始状态
loginForm.style.display = 'flex';
registerForm.style.display = 'none';

// ============ 主题切换按钮 ============
const themeToggle = document.getElementById('theme-toggle');
function renderThemeIcon() {
  const current = themeState.getCurrentTheme();
  const iconMap = { system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };
  if (themeToggle) {
    themeToggle.setAttribute('icon', iconMap[current] || 'brightness_auto');
  }
}
renderThemeIcon();
themeToggle?.addEventListener('click', () => {
  const current = themeState.getCurrentTheme();
  const next = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
  themeState.applyTheme(next);
  renderThemeIcon();
  showInfo(`主题: ${next === 'system' ? '跟随系统' : next === 'light' ? '浅色' : '暗色'}`);
});

// ============ 表单错误显示 ============
function setError(form, field, message) {
  const errorEl = form.querySelector(`[data-error="${field}"]`);
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.style.color = message ? 'rgb(var(--mdui-color-error))' : '';
  }
  // 设置对应输入框的错误状态
  const fieldId = field === 'username' ? `${form.id === 'login-form' ? 'login' : 'register'}-username`
    : field === 'password' ? `${form.id === 'login-form' ? 'login' : 'register'}-password`
    : field === 'confirmPassword' ? 'register-confirm'
    : '';
  const inputEl = document.getElementById(fieldId);
  if (inputEl) {
    if (message) {
      inputEl.setAttribute('error', message);
    } else {
      inputEl.removeAttribute('error');
    }
  }
}

function clearErrors(form) {
  form.querySelectorAll('[data-error]').forEach((e) => (e.textContent = ''));
  form.querySelectorAll('mdui-text-field').forEach((el) => el.removeAttribute('error'));
}

// ============ 提交按钮状态 ============
function setLoading(button, loading) {
  button.loading = loading;
  button.disabled = loading;
}

// ============ 登录表单 ============
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(loginForm);

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  let hasError = false;
  if (!username) {
    setError(loginForm, 'username', '请输入用户名');
    hasError = true;
  }
  if (!password) {
    setError(loginForm, 'password', '请输入密码');
    hasError = true;
  }
  if (hasError) return;

  const submitBtn = document.getElementById('login-submit');
  setLoading(submitBtn, true);

  try {
    const user = await userState.login(username, password);
    showToast(`欢迎回来，${user.username}`, { type: 'success' });
    window.location.href = '/pages/chat.html';
  } catch (err) {
    showError(err.message || '登录失败');
  } finally {
    setLoading(submitBtn, false);
  }
});

// ============ 注册表单 ============
const registerHint = document.getElementById('register-hint');
registerHint.textContent = '第一个注册的账号将成为管理员';
registerHint.style.color = 'rgb(var(--mdui-color-on-surface-variant))';

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(registerForm);

  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const confirmPassword = document.getElementById('register-confirm').value;

  let hasError = false;
  if (!username || username.length < 3) {
    setError(registerForm, 'username', '用户名至少 3 个字符');
    hasError = true;
  } else if (username.length > 32) {
    setError(registerForm, 'username', '用户名最多 32 个字符');
    hasError = true;
  }
  if (!password || password.length < 8) {
    setError(registerForm, 'password', '密码至少 8 位');
    hasError = true;
  } else if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    setError(registerForm, 'password', '密码需包含大小写字母和数字');
    hasError = true;
  }
  if (password !== confirmPassword) {
    setError(registerForm, 'confirmPassword', '两次输入的密码不一致');
    hasError = true;
  }
  if (hasError) return;

  const submitBtn = document.getElementById('register-submit');
  setLoading(submitBtn, true);

  try {
    const user = await userState.register(username, password);
    const roleText = user.role === 'admin' ? '管理员' : '用户';
    showToast(`注册成功，欢迎 ${user.username}（${roleText}）`, { type: 'success' });
    window.location.href = '/pages/chat.html';
  } catch (err) {
    showError(err.message || '注册失败');
  } finally {
    setLoading(submitBtn, false);
  }
});

// 监听主题变化
appState.subscribe('theme', renderThemeIcon);
