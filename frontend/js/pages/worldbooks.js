/**
 * 世界书管理页逻辑
 */
import { userState } from '../stores/userState.js';
import { themeState } from '../stores/themeState.js';
import appState from '../stores/appState.js';
import { worldbookApi } from '../api/index.js';
import { showToast, showSuccess, showError } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { initMduiTheme } from '../utils/mduiTheme.js';
import { escapeHtml, truncate, formatRelativeTime, readFileAsJson, downloadFile, debounce } from '../utils/helpers.js';

let searchKeyword = '';
let allWorldbooks = [];

async function init() {
  initMduiTheme();
  themeState.init();

  const user = await userState.init();
  if (!user) {
    window.location.replace('/pages/login.html');
    return;
  }

  renderThemeIcon();
  bindEvents();
  await loadWorldbooks();

  appState.subscribe('theme', renderThemeIcon);
}

function renderThemeIcon() {
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;
  const current = themeState.getCurrentTheme();
  const iconMap = { system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };
  themeToggle.setAttribute('icon', iconMap[current] || 'brightness_auto');
}

async function loadWorldbooks() {
  const grid = document.getElementById('worldbook-grid');
  grid.innerHTML = '<div class="mgmt-loading"><mdui-circular-progress></mdui-circular-progress></div>';

  try {
    const list = await worldbookApi.list(searchKeyword ? { search: searchKeyword } : undefined);
    allWorldbooks = list;
    renderGrid(list);
  } catch (err) {
    showError(err.message || '加载世界书失败');
    grid.innerHTML = `<div class="mgmt-empty"><p>${escapeHtml(err.message || '加载失败')}</p></div>`;
  }
}

function renderGrid(worldbooks) {
  const grid = document.getElementById('worldbook-grid');

  if (!worldbooks || worldbooks.length === 0) {
    grid.innerHTML = `
      <div class="mgmt-empty">
        <div class="empty-state__icon">${getIcon('book', 48)}</div>
        <h2 class="empty-state__title">${searchKeyword ? '未找到匹配的世界书' : '还没有世界书'}</h2>
        <p class="empty-state__description">${searchKeyword ? '尝试其他关键词' : '点击右上角新建世界书'}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = worldbooks.map((wb) => {
    const entryCount = wb.entries?.length || 0;
    const meta = `${entryCount} 条目 · 更新于 ${formatRelativeTime(wb.updatedAt || wb.createdAt)}`;
    const description = wb.description || '暂无描述';

    return `
      <div class="worldbook-tile" data-id="${wb.id}">
        <div class="worldbook-tile__header">
          <div class="worldbook-tile__icon">${getIcon('book', 24)}</div>
          <div class="character-tile__info">
            <div class="worldbook-tile__name">${escapeHtml(wb.name)}</div>
            <div class="worldbook-tile__meta">${meta}</div>
          </div>
        </div>
        <div class="worldbook-tile__body">
          <div class="worldbook-tile__desc">${escapeHtml(truncate(description, 100))}</div>
        </div>
        <div class="worldbook-tile__actions">
          <mdui-button-icon icon="edit" label="编辑" data-action="edit"></mdui-button-icon>
          <mdui-button-icon icon="download" label="导出" data-action="export"></mdui-button-icon>
          <mdui-button-icon icon="delete" label="删除" data-action="delete" style="color: rgb(var(--mdui-color-error));"></mdui-button-icon>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.worldbook-tile').forEach((tile) => {
    const id = tile.dataset.id;
    tile.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAction(btn.dataset.action, id);
      });
    });
  });
}

async function handleAction(action, id) {
  const wb = allWorldbooks.find((w) => w.id === id);
  if (!wb) return;

  switch (action) {
    case 'edit':
      showWorldbookDetail(wb);
      break;
    case 'export':
      try {
        const data = await worldbookApi.export(id);
        downloadFile(JSON.stringify(data, null, 2), `worldbook-${wb.name}.json`);
        showSuccess('已导出');
      } catch (err) {
        showError(err.message || '导出失败');
      }
      break;
    case 'delete':
      const ok = await confirm(`确定要删除世界书「${wb.name}」吗？此操作不可恢复。`, '删除世界书');
      if (!ok) return;
      try {
        await worldbookApi.delete(id);
        showSuccess('已删除');
        await loadWorldbooks();
      } catch (err) {
        showError(err.message || '删除失败');
      }
      break;
  }
}

// ============ 世界书创建表单 ============
async function showWorldbookForm(worldbook = null) {
  const isEdit = !!worldbook;
  const wb = worldbook || {};

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <label class="form-group__label">名称 *</label>
        <mdui-text-field id="wb-name" variant="outlined" value="${escapeHtml(wb.name || '')}" placeholder="世界书名称"></mdui-text-field>
      </div>

      <div class="form-group">
        <label class="form-group__label">描述</label>
        <mdui-text-field id="wb-description" variant="outlined" rows="3" placeholder="世界书用途说明">${escapeHtml(wb.description || '')}</mdui-text-field>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">扫描深度</label>
          <mdui-text-field id="wb-scan-depth" type="number" variant="outlined" value="${wb.settings?.scanDepth ?? 10}" min="1" max="100"></mdui-text-field>
        </div>
        <div class="form-group">
          <label class="form-group__label">预算</label>
          <mdui-text-field id="wb-budget" type="number" variant="outlined" value="${wb.settings?.budgetDefault ?? 1000}" min="100" max="100000"></mdui-text-field>
        </div>
      </div>
    </div>
  `;

  await showModal({
    title: isEdit ? '编辑世界书信息' : '新建世界书',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isEdit ? '保存' : '创建', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const name = dialog.querySelector('#wb-name').value.trim();
        if (!name) {
          showError('名称不能为空');
          return;
        }

        const data = {
          name,
          description: dialog.querySelector('#wb-description').value.trim() || undefined,
          settings: {
            scanDepth: parseInt(dialog.querySelector('#wb-scan-depth').value, 10) || 10,
            budgetDefault: parseInt(dialog.querySelector('#wb-budget').value, 10) || 1000,
          },
        };

        try {
          if (isEdit) {
            await worldbookApi.update(wb.id, data);
            showSuccess('已保存');
            close('saved');
            await loadWorldbooks();
            // 重新打开详情
            const updated = await worldbookApi.get(wb.id);
            showWorldbookDetail(updated);
          } else {
            const created = await worldbookApi.create(data);
            showSuccess('已创建');
            close('created');
            await loadWorldbooks();
            showWorldbookDetail(created);
          }
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

// ============ 世界书详情（条目管理） ============
async function showWorldbookDetail(wb) {
  // 重新获取最新数据
  let current = wb;
  try {
    current = await worldbookApi.get(wb.id);
  } catch {
    // 使用传入的数据
  }

  const entriesHtml = current.entries && current.entries.length > 0
    ? current.entries.map((entry) => renderEntryHtml(entry)).join('')
    : `<div class="empty-state" style="padding: var(--md-sys-spacing-6);">
        <p class="empty-state__description">暂无条目，点击下方按钮添加</p>
       </div>`;

  const content = `
    <div style="display: flex; flex-direction: column; gap: var(--md-sys-spacing-3); min-width: 560px; max-width: 720px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--md-sys-spacing-3);">
        <div>
          <h3 style="font-family: var(--md-sys-typescale-font-family-brand); font-size: 22px; color: var(--md-sys-color-on-surface); margin: 0;">${escapeHtml(current.name)}</h3>
          <p style="font-size: 13px; color: var(--md-sys-color-on-surface-variant); margin: 4px 0 0;">${current.entries?.length || 0} 个条目</p>
        </div>
        <div style="display: flex; gap: var(--md-sys-spacing-2);">
          <mdui-button variant="outlined" id="wb-edit-info-btn">编辑信息</mdui-button>
          <mdui-button variant="filled" id="wb-add-entry-btn" icon="add">添加条目</mdui-button>
        </div>
      </div>
      <div class="worldbook-entries" id="entries-list">
        ${entriesHtml}
      </div>
    </div>
  `;

  await showModal({
    title: '世界书详情',
    content,
    actions: [{ text: '关闭', value: 'close', type: 'text' }],
    onMount: (dialog, close) => {
      dialog.querySelector('#wb-edit-info-btn').addEventListener('click', async () => {
        close('edit-info');
        await showWorldbookForm(current);
      });

      dialog.querySelector('#wb-add-entry-btn').addEventListener('click', async () => {
        close('add-entry');
        await showEntryForm(current.id, null);
      });

      // 条目操作
      dialog.querySelectorAll('[data-entry-uid]').forEach((el) => {
        const uid = el.dataset.entryUid;
        el.querySelector('[data-action="edit-entry"]')?.addEventListener('click', async () => {
          close('edit-entry');
          const entry = current.entries.find((e) => e.uid === uid);
          if (entry) await showEntryForm(current.id, entry);
        });
        el.querySelector('[data-action="delete-entry"]')?.addEventListener('click', async () => {
          const entry = current.entries.find((e) => e.uid === uid);
          if (!entry) return;
          const ok = await confirm(`确定要删除条目「${entry.name || '未命名'}」吗？`, '删除条目');
          if (!ok) return;
          try {
            await worldbookApi.deleteEntry(current.id, uid);
            showSuccess('已删除');
            close('deleted');
            const updated = await worldbookApi.get(current.id);
            await loadWorldbooks();
            showWorldbookDetail(updated);
          } catch (err) {
            showError(err.message || '删除失败');
          }
        });
      });
    },
  });
}

function renderEntryHtml(entry) {
  const keys = (entry.keys || []).map((k) => `<span class="worldbook-entry__key">${escapeHtml(k)}</span>`).join('');
  const badges = [];
  if (entry.constant) badges.push('<span class="worldbook-entry__badge worldbook-entry__badge--constant">常驻</span>');
  if (!entry.enabled) badges.push('<span class="worldbook-entry__badge worldbook-entry__badge--disabled">已禁用</span>');
  badges.push(`<span class="worldbook-entry__badge">优先级: ${entry.priority ?? 0}</span>`);
  badges.push(`<span class="worldbook-entry__badge">位置: ${entry.position === 'after' ? '后置' : '前置'}</span>`);

  return `
    <div class="worldbook-entry" data-entry-uid="${entry.uid}">
      <div class="worldbook-entry__header">
        <div class="worldbook-entry__title">${escapeHtml(entry.name || '未命名条目')}</div>
        <div style="display: flex; gap: var(--md-sys-spacing-1);">
          <mdui-button-icon icon="edit" label="编辑" data-action="edit-entry"></mdui-button-icon>
          <mdui-button-icon icon="delete" label="删除" data-action="delete-entry" style="color: rgb(var(--mdui-color-error));"></mdui-button-icon>
        </div>
      </div>
      ${entry.comment ? `<div style="font-size: 12px; color: var(--md-sys-color-on-surface-variant); margin-bottom: var(--md-sys-spacing-1);">${escapeHtml(entry.comment)}</div>` : ''}
      ${keys ? `<div class="worldbook-entry__keys">${keys}</div>` : ''}
      <div class="worldbook-entry__content">${escapeHtml(truncate(entry.content || '', 300))}</div>
      <div class="worldbook-entry__badges">${badges.join('')}</div>
    </div>
  `;
}

// ============ 条目表单 ============
async function showEntryForm(worldbookId, entry = null) {
  const isEdit = !!entry;
  const e = entry || {};

  const content = `
    <div class="mgmt-form">
      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">名称</label>
          <mdui-text-field id="entry-name" variant="outlined" value="${escapeHtml(e.name || '')}" placeholder="条目名称（可选）"></mdui-text-field>
        </div>
        <div class="form-group">
          <label class="form-group__label">优先级</label>
          <mdui-text-field id="entry-priority" type="number" variant="outlined" value="${e.priority ?? 10}" min="0" max="1000"></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">关键词（逗号分隔）</label>
        <mdui-text-field id="entry-keys" variant="outlined" value="${escapeHtml((e.keys || []).join(', '))}" placeholder="hero, magic, ..."></mdui-text-field>
      </div>

      <div class="form-group">
        <label class="form-group__label">内容</label>
        <mdui-text-field id="entry-content" variant="outlined" rows="6" placeholder="条目内容，触发关键词时注入到对话中">${escapeHtml(e.content || '')}</mdui-text-field>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">位置</label>
          <mdui-select id="entry-position" variant="outlined" value="${e.position || 'before'}">
            <mdui-menu-item value="before">前置（角色定义前）</mdui-menu-item>
            <mdui-menu-item value="after">后置（角色定义后）</mdui-menu-item>
          </mdui-select>
        </div>
        <div class="form-group">
          <label class="form-group__label">插入顺序</label>
          <mdui-text-field id="entry-order" type="number" variant="outlined" value="${e.insertionOrder ?? 100}" min="0" max="1000"></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">备注</label>
        <mdui-text-field id="entry-comment" variant="outlined" value="${escapeHtml(e.comment || '')}" placeholder="条目备注（可选）"></mdui-text-field>
      </div>

      <div style="display: flex; gap: var(--md-sys-spacing-4); flex-wrap: wrap;">
        <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
          <mdui-switch id="entry-enabled" ${e.enabled !== false ? 'checked' : ''}></mdui-switch>
          <span style="font-size: 14px;">启用</span>
        </label>
        <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
          <mdui-switch id="entry-constant" ${e.constant ? 'checked' : ''}></mdui-switch>
          <span style="font-size: 14px;">常驻（始终注入）</span>
        </label>
        <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
          <mdui-switch id="entry-case-sensitive" ${e.caseSensitive ? 'checked' : ''}></mdui-switch>
          <span style="font-size: 14px;">区分大小写</span>
        </label>
      </div>
    </div>
  `;

  await showModal({
    title: isEdit ? '编辑条目' : '添加条目',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isEdit ? '保存' : '添加', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const data = {
          name: dialog.querySelector('#entry-name').value.trim() || undefined,
          keys: dialog.querySelector('#entry-keys').value
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
          content: dialog.querySelector('#entry-content').value,
          position: dialog.querySelector('#entry-position').value,
          priority: parseInt(dialog.querySelector('#entry-priority').value, 10) || 0,
          insertionOrder: parseInt(dialog.querySelector('#entry-order').value, 10) || 100,
          comment: dialog.querySelector('#entry-comment').value.trim() || undefined,
          enabled: dialog.querySelector('#entry-enabled').checked,
          constant: dialog.querySelector('#entry-constant').checked,
          caseSensitive: dialog.querySelector('#entry-case-sensitive').checked,
        };

        if (!data.content) {
          showError('内容不能为空');
          return;
        }

        try {
          if (isEdit) {
            await worldbookApi.updateEntry(worldbookId, e.uid, data);
            showSuccess('已保存');
          } else {
            await worldbookApi.addEntry(worldbookId, data);
            showSuccess('已添加');
          }
          close('saved');
          await loadWorldbooks();
          const updated = await worldbookApi.get(worldbookId);
          showWorldbookDetail(updated);
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

// ============ 导入 ============
async function handleImport(file) {
  try {
    const data = await readFileAsJson(file);
    // SillyTavern 导出的世界书 JSON 通常只有 entries 字段，name 来自文件名
    if (!data.name) {
      data.name = file.name.replace(/\.json$/i, '');
    }
    await worldbookApi.import(data);
    showSuccess('世界书导入成功');
    await loadWorldbooks();
  } catch (err) {
    showError(err.message || '导入失败');
  }
}

// ============ 事件 ============
function bindEvents() {
  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = '/pages/chat.html';
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = themeState.getCurrentTheme();
    const next = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
    themeState.applyTheme(next);
    renderThemeIcon();
  });

  document.getElementById('search-input').addEventListener('input', debounce((e) => {
    searchKeyword = (e.target.value || '').trim();
    loadWorldbooks();
  }, 300));

  document.getElementById('create-btn').addEventListener('click', () => showWorldbookForm());

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImport(file);
    e.target.value = '';
  });
}

init();
