/**
 * 模块 7: 个性 (Personas)
 * 创建和管理用户个性，用于 AI 角色扮演中的"我"
 */
import appState from '../stores/appState.js';
import { showSuccess, showError } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml, generateId } from '../utils/helpers.js';
import storage from '../utils/storage.js';
import { fileApi } from '../api/index.js';

const PERSONAS_KEY = 'cp_personas';
const DEFAULT_PERSONA_KEY = 'cp_default_persona';
const ACTIVE_PERSONA_KEY = 'cp_active_persona';

const DEFAULT_PERSONAS = [
  {
    id: 'default_user',
    name: '用户',
    avatar: '',
    description: '我是一个普通用户。',
    position: 0,
    depth: 2,
    role: 0,
    lorebook: '',
    title: '',
  },
];

function loadPersonas() {
  return storage.get(PERSONAS_KEY, DEFAULT_PERSONAS);
}
function savePersonas(personas) {
  storage.set(PERSONAS_KEY, personas);
}
function loadDefault() {
  return storage.get(DEFAULT_PERSONA_KEY, 'default_user');
}
function saveDefault(id) {
  storage.set(DEFAULT_PERSONA_KEY, id);
}
function loadActive() {
  return storage.get(ACTIVE_PERSONA_KEY, loadDefault());
}
function saveActive(id) {
  storage.set(ACTIVE_PERSONA_KEY, id);
}

/**
 * 渲染个性模块
 */
export function renderPersonas(container, opts = {}) {
  const personas = loadPersonas();
  const defaultId = loadDefault();
  const activeId = loadActive();

  container.innerHTML = `
    <div class="cp-toolbar">
      <span class="cp-toolbar__title">用户个性管理</span>
      <mdui-button variant="filled" id="cp-persona-add" icon="add">新建个性</mdui-button>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('face', 18)}</span>
        个性列表
      </h3>
      <div class="cp-persona-grid" id="cp-persona-grid"></div>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('settings', 18)}</span>
        全局设置
      </h3>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">显示个性切换通知</div>
          <div class="cp-switch-row__desc">切换个性时显示 Toast 提示</div>
        </div>
        <mdui-switch id="persona-notif" ${storage.get('cp_persona_notif', true) ? 'checked' : ''}></mdui-switch>
      </div>
    </div>

    <div class="cp-section" id="cp-persona-editor" style="display: none;">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('edit', 18)}</span>
        编辑个性
      </h3>
      <div id="cp-persona-editor-content"></div>
    </div>
  `;

  renderPersonaGrid(container.querySelector('#cp-persona-grid'), personas, defaultId, activeId);

  container.querySelector('#cp-persona-add')?.addEventListener('click', () => {
    showPersonaForm(null, () => renderPersonas(container, { force: true }));
  });

  container.querySelector('#persona-notif')?.addEventListener('change', (e) => {
    storage.set('cp_persona_notif', e.target.checked);
  });
}

function renderPersonaGrid(grid, personas, defaultId, activeId) {
  if (!personas || personas.length === 0) {
    grid.innerHTML = '<div class="cp-empty"><div class="cp-empty__title">还没有个性</div><div class="cp-empty__desc">点击上方"新建个性"</div></div>';
    return;
  }

  grid.innerHTML = personas.map((p) => {
    const avatar = p.avatar
      ? `<img src="${p.avatar}" alt="" />`
      : escapeHtml((p.name || '?').charAt(0).toUpperCase());
    const isActive = p.id === activeId;
    return `
      <mdui-card class="cp-persona-card ${isActive ? 'cp-persona-card--active' : ''}" variant="filled" clickable data-id="${p.id}">
        <div class="cp-persona-card__avatar">${avatar}</div>
        <div class="cp-persona-card__name">${escapeHtml(p.name || '未命名')}</div>
        <div class="cp-persona-card__actions">
          <mdui-button-icon icon="check_circle" data-action="select" label="使用此个性"></mdui-button-icon>
          <mdui-button-icon icon="edit" data-action="edit" label="编辑"></mdui-button-icon>
          <mdui-button-icon icon="delete" data-action="delete" label="删除" style="color: var(--md-sys-color-error);"></mdui-button-icon>
        </div>
      </mdui-card>
    `;
  }).join('');

  grid.querySelectorAll('.cp-persona-card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const persona = personas.find((p) => p.id === id);
        if (!persona) return;

        if (action === 'select') {
          saveActive(id);
          appState.set('activePersona', persona);
          renderPersonaGrid(grid, personas, defaultId, id);
          if (storage.get('cp_persona_notif', true)) {
            showSuccess(`已切换到个性"${persona.name}"`);
          }
        } else if (action === 'edit') {
          showPersonaForm(persona, () => renderPersonas(document.getElementById('cp-content-personas'), { force: true }));
        } else if (action === 'delete') {
          if (id === defaultId) {
            showError('不能删除默认个性');
            return;
          }
          const ok = await confirm(`确定要删除个性"${persona.name}"吗？`, '删除个性');
          if (!ok) return;
          const updated = personas.filter((p) => p.id !== id);
          savePersonas(updated);
          if (id === activeId) {
            saveActive(defaultId);
          }
          renderPersonas(document.getElementById('cp-content-personas'), { force: true });
          showSuccess('已删除');
        }
      });
    });
  });
}

function showPersonaForm(persona, callback) {
  const isEdit = !!persona;
  const p = persona || {
    id: generateId(),
    name: '',
    avatar: '',
    description: '',
    position: 0,
    depth: 2,
    role: 0,
    lorebook: '',
    title: '',
  };

  showModal({
    title: isEdit ? '编辑个性' : '新建个性',
    content: `
      <div class="mgmt-form">
        <div class="form-group">
          <mdui-text-field id="persona-name" label="名称 *" variant="outlined" value="${escapeHtml(p.name)}" placeholder="如：勇者小明"></mdui-text-field>
        </div>

        <div class="form-group">
          <label class="form-group__label">头像</label>
          <div class="avatar-upload" id="persona-avatar-upload">
            <div class="avatar-upload__preview" id="persona-avatar-preview">
              ${p.avatar ? `<img src="${p.avatar}" alt="" />` : '<span class="avatar-upload__placeholder">点击上传</span>'}
            </div>
            <div class="avatar-upload__actions">
              <mdui-button variant="tonal" id="persona-avatar-btn">选择图片</mdui-button>
              ${p.avatar ? '<mdui-button variant="text" id="persona-avatar-clear">清除</mdui-button>' : ''}
            </div>
            <input type="file" id="persona-avatar-input" accept="image/*" hidden />
            <input type="hidden" id="persona-avatar" value="${escapeHtml(p.avatar)}" />
          </div>
        </div>

        <div class="form-group">
          <mdui-text-field id="persona-description" label="描述" variant="outlined" rows="6" autosize max-rows="15" placeholder="描述这个个性的特点。支持宏：{{user}}, {{char}}" value="${escapeHtml(p.description)}"></mdui-text-field>
        </div>

        <div class="mgmt-form__row">
          <div class="form-group">
            <mdui-select id="persona-position" label="描述注入位置" variant="outlined" value="${p.position}">
              <mdui-menu-item value="0">在 Story String / Prompt Manager 中</mdui-menu-item>
              <mdui-menu-item value="2">Author's Note 顶部</mdui-menu-item>
              <mdui-menu-item value="3">Author's Note 底部</mdui-menu-item>
              <mdui-menu-item value="4">聊天中指定深度</mdui-menu-item>
              <mdui-menu-item value="9">禁用</mdui-menu-item>
            </mdui-select>
          </div>
          <div class="form-group">
            <mdui-text-field id="persona-depth" label="注入深度（仅 At Depth）" variant="outlined" type="number" value="${p.depth}" min="0" max="50"></mdui-text-field>
          </div>
          <div class="form-group">
            <mdui-select id="persona-role" label="注入角色" variant="outlined" value="${p.role}">
              <mdui-menu-item value="0">System</mdui-menu-item>
              <mdui-menu-item value="1">User</mdui-menu-item>
              <mdui-menu-item value="2">Assistant</mdui-menu-item>
            </mdui-select>
          </div>
        </div>

        <div class="form-group">
          <mdui-text-field id="persona-title" label="标题（可选）" variant="outlined" value="${escapeHtml(p.title)}" placeholder="显示标题"></mdui-text-field>
        </div>

        ${isEdit ? `
          <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
            <mdui-switch id="persona-default" ${p.id === loadDefault() ? 'checked' : ''}></mdui-switch>
            <span style="font-size: 14px;">设为默认个性</span>
          </label>
        ` : ''}
      </div>
    `,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isEdit ? '保存' : '创建', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      // 头像上传
      const avatarInput = dialog.querySelector('#persona-avatar-input');
      const avatarPreview = dialog.querySelector('#persona-avatar-preview');
      const avatarHidden = dialog.querySelector('#persona-avatar');
      dialog.querySelector('#persona-avatar-btn').addEventListener('click', () => avatarInput.click());
      avatarPreview.addEventListener('click', () => avatarInput.click());
      dialog.querySelector('#persona-avatar-clear')?.addEventListener('click', () => {
        if (avatarHidden.value) fileApi.deleteFile(avatarHidden.value).catch(() => {});
        avatarHidden.value = '';
        avatarPreview.innerHTML = '<span class="avatar-upload__placeholder">点击上传</span>';
        dialog.querySelector('#persona-avatar-clear')?.remove();
      });
      avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files[0];
        if (!file) return;
        try {
          if (avatarHidden.value) fileApi.deleteFile(avatarHidden.value).catch(() => {});
          const result = await fileApi.uploadAvatar(file);
          avatarHidden.value = result.url;
          avatarPreview.innerHTML = `<img src="${result.url}" alt="" />`;
          if (!dialog.querySelector('#persona-avatar-clear')) {
            const clearBtn = document.createElement('mdui-button');
            clearBtn.variant = 'text';
            clearBtn.id = 'persona-avatar-clear';
            clearBtn.textContent = '清除';
            clearBtn.addEventListener('click', () => {
              if (avatarHidden.value) fileApi.deleteFile(avatarHidden.value).catch(() => {});
              avatarHidden.value = '';
              avatarPreview.innerHTML = '<span class="avatar-upload__placeholder">点击上传</span>';
              clearBtn.remove();
            });
            dialog.querySelector('.avatar-upload__actions').appendChild(clearBtn);
          }
        } catch (err) {
          showError(err.message || '上传失败');
        }
        avatarInput.value = '';
      });

      dialog.querySelector('[data-action="save"]').addEventListener('click', () => {
        const name = dialog.querySelector('#persona-name').value.trim();
        if (!name) {
          showError('名称不能为空');
          return;
        }

        const updated = {
          ...p,
          name,
          avatar: dialog.querySelector('#persona-avatar').value.trim(),
          description: dialog.querySelector('#persona-description').value,
          position: parseInt(dialog.querySelector('#persona-position').value, 10),
          depth: parseInt(dialog.querySelector('#persona-depth').value, 10) || 0,
          role: parseInt(dialog.querySelector('#persona-role').value, 10),
          title: dialog.querySelector('#persona-title').value.trim(),
        };

        const personas = loadPersonas();
        const idx = personas.findIndex((pe) => pe.id === p.id);
        if (idx >= 0) {
          personas[idx] = updated;
        } else {
          personas.push(updated);
        }
        savePersonas(personas);

        // 设为默认
        if (dialog.querySelector('#persona-default')?.checked) {
          saveDefault(p.id);
        } else if (p.id === loadDefault() && isEdit) {
          // 取消默认
          if (!dialog.querySelector('#persona-default').checked && personas.length > 0) {
            saveDefault(personas[0].id);
          }
        }

        close('saved');
        if (callback) callback();
        showSuccess(isEdit ? '已保存' : '已创建');
      });
    },
  });
}

/**
 * 获取当前激活的个性
 */
export function getActivePersona() {
  const id = loadActive();
  const personas = loadPersonas();
  return personas.find((p) => p.id === id) || personas[0];
}

export default { renderPersonas, getActivePersona };
