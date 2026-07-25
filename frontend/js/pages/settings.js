/**
 * 设置页逻辑
 */
import { userState } from '../stores/userState.js';
import { themeState } from '../stores/themeState.js';
import appState from '../stores/appState.js';
import { authApi, userApi, llmConfigApi, systemApi } from '../api/index.js';
import { showToast, showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { initMduiTheme } from '../utils/mduiTheme.js';
import { escapeHtml, formatRelativeTime, debounce } from '../utils/helpers.js';

let currentUser = null;
let userSearchKeyword = '';

async function init() {
  initMduiTheme();
  themeState.init();

  currentUser = await userState.init();
  if (!currentUser) {
    window.location.replace('/login');
    return;
  }

  renderThemeIcon();
  renderProfile();
  renderThemeOptions();
  bindEvents();

  await loadLlmConfigs();

  // 管理员显示用户管理
  if (currentUser.role === 'admin') {
    document.getElementById('users-section').classList.remove('hidden');
    loadSystemConfig();
    // 如果 URL 带 #users 锚点，自动加载
    if (window.location.hash === '#users') {
      loadUsers();
    }
  }

  // 监听主题变化
  appState.subscribe('theme', renderThemeIcon);
  appState.subscribe('theme', renderThemeOptions);
}

function renderThemeIcon() {
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;
  const current = themeState.getCurrentTheme();
  const iconMap = { system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };
  themeToggle.setAttribute('icon', iconMap[current] || 'brightness_auto');
}

function renderProfile() {
  const user = userState.getCurrentUser();
  if (!user) return;

  document.getElementById('profile-username').textContent = user.username;
  document.getElementById('profile-role').textContent = user.role === 'admin' ? '管理员' : '普通用户';

  const avatar = document.getElementById('profile-avatar');
  if (user.avatar) {
    avatar.innerHTML = `<img src="${user.avatar}" alt="" />`;
  } else {
    avatar.textContent = user.username.charAt(0).toUpperCase();
  }
}

function renderThemeOptions() {
  const current = themeState.getCurrentTheme();
  const group = document.getElementById('theme-options');
  if (group) group.value = current;
}

// ============ LLM 配置 ============
export async function loadLlmConfigs() {
  const list = document.getElementById('llm-configs-list');
  if (list) {
    list.innerHTML = '<div class="mgmt-loading"><mdui-circular-progress></mdui-circular-progress></div>';
  }

  try {
    const configs = await llmConfigApi.list();
    if (list) renderLlmConfigs(configs);
    return configs;
  } catch (err) {
    showError(err.message || '加载 LLM 配置失败');
    if (list) list.innerHTML = `<p style="color: var(--md-sys-color-error);">${escapeHtml(err.message || '加载失败')}</p>`;
    return [];
  }
}

function renderLlmConfigs(configs) {
  const list = document.getElementById('llm-configs-list');
  if (!list) return;

  if (!configs || configs.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding: var(--md-sys-spacing-6);">
        <p class="empty-state__description">还没有 LLM 配置，点击上方添加</p>
      </div>
    `;
    return;
  }

  list.innerHTML = configs.map((c) => `
    <div class="llm-config-card" data-id="${c.id}">
      <div class="llm-config-card__info">
        <div class="llm-config-card__name">
          ${escapeHtml(c.name)}
          ${c.isDefault ? '<mdui-chip style="margin-left: 8px;">默认</mdui-chip>' : ''}
        </div>
        <div class="llm-config-card__meta">
          <span class="llm-config-card__provider">${escapeHtml(c.provider)}</span>
          ${escapeHtml(c.model)} · Key: ${escapeHtml(c.apiKey || '***')}
        </div>
      </div>
      <div style="display: flex; gap: var(--md-sys-spacing-1);">
        <mdui-button-icon icon="check_circle" label="测试连接" data-action="test"></mdui-button-icon>
        <mdui-button-icon icon="edit" label="编辑" data-action="edit"></mdui-button-icon>
        <mdui-button-icon icon="delete" label="删除" data-action="delete" style="color: var(--md-sys-color-error);"></mdui-button-icon>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.llm-config-card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleLlmAction(btn.dataset.action, id, configs));
    });
  });
}

async function handleLlmAction(action, id, configs) {
  const config = configs.find((c) => c.id === id);
  if (!config) return;

  switch (action) {
    case 'test':
      showInfo('正在测试连接...');
      try {
        const result = await llmConfigApi.test(id);
        if (result.success) {
          showSuccess(`连接成功: ${result.message || 'OK'}`);
        } else {
          showError(`连接失败: ${result.message || '未知错误'}`);
        }
      } catch (err) {
        showError(err.message || '测试失败');
      }
      break;
    case 'edit':
      showLlmForm(config);
      break;
    case 'delete':
      const ok = await confirm(`确定要删除配置「${config.name}」吗？`, '删除配置');
      if (!ok) return;
      try {
        await llmConfigApi.delete(id);
        showSuccess('已删除');
        await loadLlmConfigs();
      } catch (err) {
        showError(err.message || '删除失败');
      }
      break;
  }
}

export async function showLlmForm(config = null) {
  const isEdit = !!config;
  const c = config || {};

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <label class="form-group__label">配置名称 *</label>
        <mdui-text-field variant="outlined" id="llm-name" value="${escapeHtml(c.name || '')}" placeholder="如：我的 GPT-4" required></mdui-text-field>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">提供商 *</label>
          <mdui-select id="llm-provider" variant="outlined" value="${c.provider || 'openai'}">
            <mdui-menu-item value="openai">OpenAI</mdui-menu-item>
            <mdui-menu-item value="anthropic">Anthropic</mdui-menu-item>
            <mdui-menu-item value="custom">自定义</mdui-menu-item>
          </mdui-select>
        </div>
        <div class="form-group">
          <label class="form-group__label">模型 *</label>
          <mdui-text-field variant="outlined" id="llm-model" value="${escapeHtml(c.model || '')}" placeholder="如：gpt-4o, claude-3-opus" required></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">API Key ${isEdit ? '（留空则不修改）' : '*'}</label>
        <mdui-text-field variant="outlined" id="llm-api-key" type="password" placeholder="${isEdit ? escapeHtml(c.apiKey || '***') : 'sk-...'}" ${isEdit ? '' : 'required'}></mdui-text-field>
      </div>

      <div class="form-group">
        <label class="form-group__label">Base URL（可选）</label>
        <mdui-text-field variant="outlined" id="llm-base-url" value="${escapeHtml(c.baseUrl || '')}" placeholder="https://api.openai.com/v1"></mdui-text-field>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">Temperature</label>
          <mdui-text-field variant="outlined" id="llm-temperature" type="number" value="${c.extraParams?.temperature ?? 0.7}" step="0.1" min="0" max="2"></mdui-text-field>
        </div>
        <div class="form-group">
          <label class="form-group__label">Max Tokens</label>
          <mdui-text-field variant="outlined" id="llm-max-tokens" type="number" value="${c.extraParams?.maxTokens ?? 2048}" min="1" max="200000"></mdui-text-field>
        </div>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">Top P</label>
          <mdui-text-field variant="outlined" id="llm-top-p" type="number" value="${c.extraParams?.topP ?? 1}" step="0.05" min="0" max="1"></mdui-text-field>
        </div>
        <div class="form-group">
          <label class="form-group__label">Top K</label>
          <mdui-text-field variant="outlined" id="llm-top-k" type="number" value="${c.extraParams?.topK ?? 0}" min="0" max="1000"></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">思维链（Reasoning）设置</label>
        <div style="display: flex; flex-direction: column; gap: var(--md-sys-spacing-2); padding: var(--md-sys-spacing-3); background-color: var(--md-sys-color-surface-container); border-radius: var(--md-sys-shape-corner-medium);">
          <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
            <mdui-switch id="llm-enable-thinking" ${c.extraParams?.thinking ? 'checked' : ''}></mdui-switch>
            <span style="font-size: 14px;">启用思维链</span>
          </label>
          <div id="llm-thinking-options" style="display: ${c.extraParams?.thinking ? 'block' : 'none'}; padding-left: var(--md-sys-spacing-2);">
            <div class="form-group" style="margin-bottom: var(--md-sys-spacing-2);">
              <label class="form-group__label">思维预算（tokens，仅 Anthropic）</label>
              <mdui-text-field variant="outlined" id="llm-thinking-budget" type="number" value="${c.extraParams?.thinking?.budget_tokens ?? 2000}" min="1024" max="64000" step="1024"></mdui-text-field>
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-group__label">Reasoning Effort（仅 OpenAI o-series）</label>
              <mdui-select id="llm-reasoning-effort" variant="outlined" value="${c.extraParams?.reasoningEffort || 'medium'}">
                <mdui-menu-item value="low">low</mdui-menu-item>
                <mdui-menu-item value="medium">medium</mdui-menu-item>
                <mdui-menu-item value="high">high</mdui-menu-item>
              </mdui-select>
            </div>
            <p style="font-size: 11px; color: var(--md-sys-color-on-surface-variant); margin-top: var(--md-sys-spacing-2);">
              注意：DeepSeek-R1、Qwen3 等模型会自动返回思维链，无需在此开启。此选项用于 Anthropic Claude 3.7+（extended thinking）和 OpenAI o-series。
            </p>
          </div>
        </div>
      </div>

      <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
        <mdui-switch id="llm-default" ${c.isDefault ? 'checked' : ''}></mdui-switch>
        <span style="font-size: 14px;">设为默认配置</span>
      </label>
    </div>
  `;

  await showModal({
    title: isEdit ? '编辑 LLM 配置' : '添加 LLM 配置',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isEdit ? '保存' : '添加', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      // 思维链开关切换
      const thinkingSwitch = dialog.querySelector('#llm-enable-thinking');
      const thinkingOptions = dialog.querySelector('#llm-thinking-options');
      thinkingSwitch?.addEventListener('change', () => {
        thinkingOptions.style.display = thinkingSwitch.checked ? 'block' : 'none';
      });

      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const name = dialog.querySelector('#llm-name').value.trim();
        const provider = dialog.querySelector('#llm-provider').value;
        const model = dialog.querySelector('#llm-model').value.trim();
        const apiKey = dialog.querySelector('#llm-api-key').value;
        const baseUrl = dialog.querySelector('#llm-base-url').value.trim() || undefined;
        const isDefault = dialog.querySelector('#llm-default').checked;
        const temperature = parseFloat(dialog.querySelector('#llm-temperature').value);
        const maxTokens = parseInt(dialog.querySelector('#llm-max-tokens').value, 10);
        const topP = parseFloat(dialog.querySelector('#llm-top-p').value);
        const topK = parseInt(dialog.querySelector('#llm-top-k').value, 10);
        const enableThinking = dialog.querySelector('#llm-enable-thinking').checked;

        if (!name || !provider || !model) {
          showError('名称、提供商、模型不能为空');
          return;
        }
        if (!isEdit && !apiKey) {
          showError('API Key 不能为空');
          return;
        }

        const extraParams = { temperature, maxTokens, topP, topK };

        // 思维链配置
        if (enableThinking) {
          if (provider === 'anthropic') {
            const budgetTokens = parseInt(dialog.querySelector('#llm-thinking-budget').value, 10) || 2000;
            extraParams.thinking = { type: 'enabled', budget_tokens: Math.max(1024, budgetTokens) };
          } else if (provider === 'openai') {
            extraParams.reasoningEffort = dialog.querySelector('#llm-reasoning-effort').value;
          } else {
            // custom 提供商兼容 OpenAI 协议
            extraParams.reasoningEffort = dialog.querySelector('#llm-reasoning-effort').value;
          }
        }

        const data = {
          name,
          provider,
          model,
          baseUrl,
          isDefault,
          extraParams,
        };
        if (apiKey) data.apiKey = apiKey;

        try {
          if (isEdit) {
            await llmConfigApi.update(c.id, data);
            showSuccess('已保存');
          } else {
            await llmConfigApi.create(data);
            showSuccess('已添加');
          }
          close('saved');
          await loadLlmConfigs();
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

// ============ 系统配置 ============
async function loadSystemConfig() {
  const toggle = document.getElementById('registration-toggle');
  if (!toggle) return;
  try {
    const config = await systemApi.getConfig();
    toggle.checked = config.registrationEnabled;
    toggle.addEventListener('change', async () => {
      try {
        await systemApi.updateConfig({ registrationEnabled: toggle.checked });
        showSuccess(toggle.checked ? '已开启注册' : '已关闭注册');
      } catch (err) {
        // 失败时回退开关状态
        toggle.checked = !toggle.checked;
        showError(err.message || '更新失败');
      }
    });
  } catch (err) {
    showError(err.message || '加载系统配置失败');
  }
}

// ============ 用户管理 ============
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;"><mdui-circular-progress style="margin: 0 auto;"></mdui-circular-progress></td></tr>';

  try {
    const result = await userApi.list(userSearchKeyword ? { search: userSearchKeyword } : undefined);
    const users = result.items || result;
    renderUsers(users);
  } catch (err) {
    showError(err.message || '加载用户列表失败');
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--md-sys-color-error);">${escapeHtml(err.message || '加载失败')}</td></tr>`;
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody');

  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--md-sys-color-on-surface-variant);">暂无用户</td></tr>';
    return;
  }

  tbody.innerHTML = users.map((u) => `
    <tr data-id="${u.id}">
      <td>${escapeHtml(u.username)}</td>
      <td>
        <span class="user-role-badge user-role-badge--${u.role}">${u.role === 'admin' ? '管理员' : '用户'}</span>
      </td>
      <td>${formatRelativeTime(u.createdAt)}</td>
      <td>
        <div style="display: flex; gap: var(--md-sys-spacing-1);">
          <mdui-button-icon icon="${u.role === 'admin' ? 'person' : 'key'}" label="${u.role === 'admin' ? '降为用户' : '升为管理员'}" data-action="toggle-role" ${u.id === currentUser.id ? 'disabled' : ''}></mdui-button-icon>
          <mdui-button-icon icon="delete" label="删除用户" data-action="delete" style="color: var(--md-sys-color-error);" ${u.id === currentUser.id ? 'disabled' : ''}></mdui-button-icon>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      const action = btn.dataset.action;
      const user = users.find((u) => u.id === id);
      if (!user) return;

      if (action === 'toggle-role') {
        const newRole = user.role === 'admin' ? 'user' : 'admin';
        const ok = await confirm(`确定要将「${user.username}」的角色改为${newRole === 'admin' ? '管理员' : '普通用户'}吗？`, '修改角色');
        if (!ok) return;
        try {
          await userApi.updateRole(id, newRole);
          showSuccess('已修改');
          await loadUsers();
        } catch (err) {
          showError(err.message || '修改失败');
        }
      } else if (action === 'delete') {
        const ok = await confirm(`确定要删除用户「${user.username}」吗？将级联删除其所有数据。此操作不可恢复。`, '删除用户');
        if (!ok) return;
        try {
          await userApi.delete(id);
          showSuccess('已删除');
          await loadUsers();
        } catch (err) {
          showError(err.message || '删除失败');
        }
      }
    });
  });
}

// ============ 创建用户（管理员） ============
async function showCreateUserForm() {
  const result = await showModal({
    title: '创建新用户',
    content: `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <mdui-text-field variant="outlined" id="new-username" label="用户名"
          placeholder="3-32位，字母/数字/下划线/中文"
          helper="用户首次登录时需要修改密码"></mdui-text-field>
        <div style="font-size: 12px; color: var(--mdui-color-on-surface-variant); padding: 8px 12px; background: rgb(var(--mdui-color-surface-container, 243 237 247)); border-radius: 8px;">
          新用户将使用默认密码 <strong>Abc123456</strong>，首次登录时必须修改密码才能使用系统。
        </div>
      </div>
    `,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '创建', value: 'create', type: 'filled' },
    ],
    closeOnOverlay: false,
    onMount: (dialog, close) => {
      const createBtn = dialog.querySelector('[data-action="create"]');
      const cloned = createBtn.cloneNode(true);
      createBtn.parentNode.replaceChild(cloned, createBtn);
      cloned.addEventListener('click', async () => {
        const username = dialog.querySelector('#new-username').value.trim();
        if (!username) { showError('用户名不能为空'); return; }
        if (username.length < 3 || username.length > 32) { showError('用户名需 3-32 个字符'); return; }

        cloned.loading = true;
        cloned.disabled = true;
        try {
          const data = await userApi.create(username);
          close('created');
          showSuccess(`用户「${username}」创建成功，默认密码：${data.defaultPassword}`);
          loadUsers();
        } catch (err) {
          cloned.loading = false;
          cloned.disabled = false;
          showError(err.message || '创建失败');
        }
      });
    },
  });
}

// ============ 编辑个人信息 ============
async function showEditProfileForm() {
  const user = userState.getCurrentUser();
  if (!user) return;

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <label class="form-group__label">用户名</label>
        <mdui-text-field variant="outlined" id="profile-username-input" value="${escapeHtml(user.username || '')}" required></mdui-text-field>
      </div>
      <div class="form-group">
        <label class="form-group__label">头像 URL</label>
        <mdui-text-field variant="outlined" id="profile-avatar-input" value="${escapeHtml(user.avatar || '')}" placeholder="https://..."></mdui-text-field>
      </div>
    </div>
  `;

  await showModal({
    title: '编辑个人信息',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '保存', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const username = dialog.querySelector('#profile-username-input').value.trim();
        const avatar = dialog.querySelector('#profile-avatar-input').value.trim();

        if (!username) {
          showError('用户名不能为空');
          return;
        }

        try {
          const updated = await userApi.update(user.id, { username, avatar: avatar || undefined });
          userState.updateUser(updated);
          showSuccess('已保存');
          close('saved');
          renderProfile();
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

// ============ 修改密码 ============
async function showChangePasswordForm() {
  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <label class="form-group__label">原密码</label>
        <mdui-text-field variant="outlined" id="old-password" type="password" required autocomplete="current-password"></mdui-text-field>
      </div>
      <div class="form-group">
        <label class="form-group__label">新密码</label>
        <mdui-text-field variant="outlined" id="new-password" type="password" required autocomplete="new-password" minlength="6"></mdui-text-field>
      </div>
      <div class="form-group">
        <label class="form-group__label">确认新密码</label>
        <mdui-text-field variant="outlined" id="confirm-password" type="password" required autocomplete="new-password" minlength="6"></mdui-text-field>
      </div>
    </div>
  `;

  await showModal({
    title: '修改密码',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '保存', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const oldPassword = dialog.querySelector('#old-password').value;
        const newPassword = dialog.querySelector('#new-password').value;
        const confirmPassword = dialog.querySelector('#confirm-password').value;

        if (!oldPassword || !newPassword) {
          showError('原密码和新密码不能为空');
          return;
        }
        if (newPassword.length < 6) {
          showError('新密码至少 6 位');
          return;
        }
        if (newPassword !== confirmPassword) {
          showError('两次输入的新密码不一致');
          return;
        }

        try {
          await authApi.updatePassword(oldPassword, newPassword);
          showSuccess('密码修改成功');
          close('saved');
        } catch (err) {
          showError(err.message || '修改失败');
        }
      });
    },
  });
}

// ============ 事件 ============
function bindEvents() {
  // 返回
  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = '/chat';
  });

  // 主题切换
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = themeState.getCurrentTheme();
    const next = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
    themeState.applyTheme(next);
    renderThemeIcon();
  });

  // 主题选项
  document.getElementById('theme-options')?.addEventListener('change', (e) => {
    themeState.applyTheme(e.target.value);
  });

  // 编辑个人信息
  document.getElementById('edit-profile-btn').addEventListener('click', showEditProfileForm);

  // 修改密码
  document.getElementById('change-password-btn').addEventListener('click', showChangePasswordForm);

  // 添加 LLM 配置
  document.getElementById('add-llm-btn').addEventListener('click', () => showLlmForm());

  // 用户管理
  document.getElementById('refresh-users-btn').addEventListener('click', loadUsers);
  document.getElementById('create-user-btn').addEventListener('click', showCreateUserForm);
  document.getElementById('user-search').addEventListener('input', debounce((e) => {
    userSearchKeyword = (e.target.value || '').trim();
    loadUsers();
  }, 300));

  // 退出登录
  document.getElementById('logout-btn').addEventListener('click', async () => {
    const ok = await confirm('确定要退出登录吗？', '退出登录');
    if (!ok) return;
    await userState.logout();
  });
}

init();
