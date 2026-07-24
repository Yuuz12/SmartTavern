/**
 * 模块 4: 世界信息
 * 管理 lorebook 及其条目，动态关键词激活设置
 */
import appState from '../stores/appState.js';
import { worldbookApi } from '../api/index.js';
import { showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml, truncate, readFileAsJson, downloadFile, debounce } from '../utils/helpers.js';
import storage from '../utils/storage.js';

let allWorldbooks = [];
let currentWorldbookId = null;
let currentEntries = [];
let searchKeyword = '';

const SCAN_SETTINGS_KEY = 'cp_wi_scan_settings';
const DEFAULT_SCAN_SETTINGS = {
  scanDepth: 4,
  minActivations: 0,
  budget: 25,
  includeNames: true,
  recursive: true,
  caseSensitive: false,
  matchWholeWords: false,
  maxRecursionSteps: 5,
};

/**
 * 渲染世界信息模块
 */
export async function renderWorldInfo(container, opts = {}) {
  const scanSettings = { ...DEFAULT_SCAN_SETTINGS, ...(storage.get(SCAN_SETTINGS_KEY, {}) || {}) };

  container.innerHTML = `
    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('book', 18)}</span>
        世界书管理
      </h3>
      <div class="cp-toolbar">
        <mdui-select id="cp-wi-select" variant="outlined" class="cp-preset-bar__select">
          <mdui-menu-item value="">选择世界书...</mdui-menu-item>
        </mdui-select>
        <mdui-button variant="filled" id="cp-wi-add" icon="add">新建</mdui-button>
        <mdui-button-icon icon="upload" label="导入" id="cp-wi-import"></mdui-button-icon>
        <mdui-button-icon icon="refresh" label="刷新" id="cp-wi-refresh"></mdui-button-icon>
      </div>
      <input type="file" id="cp-wi-file-input" accept=".json" style="display: none;" />
      <div id="cp-wi-entries"></div>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('settings', 18)}</span>
        全局扫描设置
      </h3>
      <div class="cp-grid cp-grid--3">
        <div class="cp-field">
          <label class="cp-field__label">
            扫描深度
            <span class="cp-field__hint" data-hint="scanDepth">${scanSettings.scanDepth} 条消息</span>
          </label>
          <div class="cp-slider">
            <mdui-slider id="wi-scan-depth" min="1" max="50" step="1" value="${scanSettings.scanDepth}"></mdui-slider>
          </div>
        </div>
        <div class="cp-field">
          <label class="cp-field__label">
            Token 预算
            <span class="cp-field__hint" data-hint="budget">${scanSettings.budget}%</span>
          </label>
          <div class="cp-slider">
            <mdui-slider id="wi-budget" min="0" max="100" step="5" value="${scanSettings.budget}"></mdui-slider>
          </div>
        </div>
        <div class="cp-field">
          <label class="cp-field__label">
            最小激活数
            <span class="cp-field__hint" data-hint="minActivations">${scanSettings.minActivations}</span>
          </label>
          <div class="cp-slider">
            <mdui-slider id="wi-min-act" min="0" max="20" step="1" value="${scanSettings.minActivations}"></mdui-slider>
          </div>
        </div>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">递归扫描</div>
          <div class="cp-switch-row__desc">条目内容触发其他条目</div>
        </div>
        <mdui-switch id="wi-recursive" ${scanSettings.recursive ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">大小写敏感</div>
          <div class="cp-switch-row__desc">关键词匹配时区分大小写</div>
        </div>
        <mdui-switch id="wi-case-sensitive" ${scanSettings.caseSensitive ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">全词匹配</div>
          <div class="cp-switch-row__desc">关键词必须完整匹配单词</div>
        </div>
        <mdui-switch id="wi-whole-words" ${scanSettings.matchWholeWords ? 'checked' : ''}></mdui-switch>
      </div>
    </div>
  `;

  bindScanSettings(container);

  // 加载世界书列表
  await loadWorldbooks(container);

  // 绑定事件
  container.querySelector('#cp-wi-add')?.addEventListener('click', () => showWorldbookForm());
  container.querySelector('#cp-wi-refresh')?.addEventListener('click', () => loadWorldbooks(container));

  const fileInput = container.querySelector('#cp-wi-file-input');
  container.querySelector('#cp-wi-import')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await readFileAsJson(file);
      await worldbookApi.import(data);
      showSuccess('导入成功');
      await loadWorldbooks(container);
    } catch (err) {
      showError(err.message || '导入失败');
    }
    fileInput.value = '';
  });

  container.querySelector('#cp-wi-select')?.addEventListener('change', (e) => {
    currentWorldbookId = e.target.value || null;
    if (currentWorldbookId) {
      loadEntries(container);
    } else {
      container.querySelector('#cp-wi-entries').innerHTML = '';
    }
  });
}

async function loadWorldbooks(container) {
  try {
    allWorldbooks = await worldbookApi.list();
    appState.set('worldbooks', allWorldbooks);

    const select = container.querySelector('#cp-wi-select');
    if (!select) return;

    select.innerHTML = '<mdui-menu-item value="">选择世界书...</mdui-menu-item>' +
      allWorldbooks.map((wb) => `<mdui-menu-item value="${wb.id}" ${wb.id === currentWorldbookId ? 'selected' : ''}>${escapeHtml(wb.name)}</mdui-menu-item>`).join('');

    if (currentWorldbookId && allWorldbooks.find((w) => w.id === currentWorldbookId)) {
      await loadEntries(container);
    }
  } catch (err) {
    showError(err.message || '加载世界书失败');
  }
}

async function loadEntries(container) {
  const entriesEl = container.querySelector('#cp-wi-entries');
  if (!currentWorldbookId) {
    entriesEl.innerHTML = '';
    return;
  }

  try {
    const wb = await worldbookApi.get(currentWorldbookId);
    currentEntries = wb.entries || [];

    if (currentEntries.length === 0) {
      entriesEl.innerHTML = `
        <div class="cp-empty">
          <div class="cp-empty__title">还没有条目</div>
          <div class="cp-empty__desc">点击下方"添加条目"</div>
        </div>
        <div class="cp-actions">
          <mdui-button variant="filled" id="cp-wi-add-entry" icon="add">添加条目</mdui-button>
        </div>
      `;
      entriesEl.querySelector('#cp-wi-add-entry')?.addEventListener('click', () => showEntryForm());
      return;
    }

    entriesEl.innerHTML = `
      <div class="cp-toolbar">
        <mdui-text-field variant="outlined" id="cp-wi-entry-search" class="cp-toolbar__search" placeholder="搜索条目..." value="${escapeHtml(searchKeyword)}"></mdui-text-field>
        <mdui-button variant="filled" id="cp-wi-add-entry" icon="add">添加条目</mdui-button>
        <mdui-button-icon icon="download" label="导出世界书" id="cp-wi-export"></mdui-button-icon>
        <mdui-button-icon icon="edit" label="编辑世界书信息" id="cp-wi-edit-wb"></mdui-button-icon>
        <mdui-button-icon icon="delete" label="删除世界书" id="cp-wi-delete-wb" style="color: var(--md-sys-color-error);"></mdui-button-icon>
      </div>
      <div id="cp-wi-entry-list"></div>
    `;

    renderEntryList(entriesEl.querySelector('#cp-wi-entry-list'), currentEntries);

    entriesEl.querySelector('#cp-wi-add-entry')?.addEventListener('click', () => showEntryForm());
    entriesEl.querySelector('#cp-wi-export')?.addEventListener('click', async () => {
      try {
        const data = await worldbookApi.export(currentWorldbookId);
        const wb = allWorldbooks.find((w) => w.id === currentWorldbookId);
        downloadFile(JSON.stringify(data, null, 2), `${wb?.name || 'worldbook'}.json`);
        showSuccess('已导出');
      } catch (err) {
        showError(err.message || '导出失败');
      }
    });
    entriesEl.querySelector('#cp-wi-edit-wb')?.addEventListener('click', () => {
      const wb = allWorldbooks.find((w) => w.id === currentWorldbookId);
      if (wb) showWorldbookForm(wb);
    });
    entriesEl.querySelector('#cp-wi-delete-wb')?.addEventListener('click', async () => {
      const wb = allWorldbooks.find((w) => w.id === currentWorldbookId);
      if (!wb) return;
      const ok = await confirm(`确定要删除世界书「${wb.name}」吗？所有条目将丢失。`, '删除世界书');
      if (!ok) return;
      try {
        await worldbookApi.delete(currentWorldbookId);
        showSuccess('已删除');
        currentWorldbookId = null;
        currentEntries = [];
        await loadWorldbooks(container);
        entriesEl.innerHTML = '';
      } catch (err) {
        showError(err.message || '删除失败');
      }
    });

    entriesEl.querySelector('#cp-wi-entry-search')?.addEventListener('input', debounce((e) => {
      searchKeyword = e.target.value.trim();
      renderEntryList(entriesEl.querySelector('#cp-wi-entry-list'), currentEntries);
    }, 300));
  } catch (err) {
    showError(err.message || '加载条目失败');
  }
}

function renderEntryList(container, entries) {
  const filtered = searchKeyword
    ? entries.filter((e) => (e.comment || '').toLowerCase().includes(searchKeyword.toLowerCase()) || (e.key || []).some((k) => k.toLowerCase().includes(searchKeyword.toLowerCase())))
    : entries;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="cp-empty"><div class="cp-empty__title">${searchKeyword ? '未找到匹配条目' : '暂无条目'}</div></div>`;
    return;
  }

  container.innerHTML = filtered.map((entry) => {
    const keys = Array.isArray(entry.key) ? entry.key : [entry.key];
    const keysStr = keys.filter(Boolean).join(', ');
    return `
      <div class="cp-wi-entry" data-uid="${entry.uid}">
        <div class="cp-wi-entry__header">
          <span class="cp-badge">${entry.order ?? 100}</span>
          <span class="cp-wi-entry__title">${escapeHtml(entry.comment || keysStr || '未命名')}</span>
          ${entry.constant ? '<span class="cp-badge cp-badge--warning"><span class="cp-badge__dot"></span>常驻</span>' : ''}
          ${entry.disable ? '<span class="cp-badge cp-badge--error"><span class="cp-badge__dot"></span>禁用</span>' : ''}
          <div style="margin-left: auto; display: flex; gap: 2px;">
            <mdui-button-icon icon="edit" data-action="edit-entry" label="编辑"></mdui-button-icon>
            <mdui-button-icon icon="delete" data-action="delete-entry" label="删除" style="color: var(--md-sys-color-error);"></mdui-button-icon>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.cp-wi-entry').forEach((el) => {
    const uid = el.dataset.uid;
    el.querySelector('.cp-wi-entry__header')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      el.classList.toggle('cp-wi-entry--expanded');
    });

    el.querySelector('[data-action="edit-entry"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = currentEntries.find((en) => String(en.uid) === String(uid));
      if (entry) showEntryForm(entry);
    });

    el.querySelector('[data-action="delete-entry"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirm('确定要删除这个条目吗？', '删除条目');
      if (!ok) return;
      try {
        await worldbookApi.deleteEntry(currentWorldbookId, uid);
        showSuccess('已删除');
        const container = document.getElementById('cp-content-world-info');
        if (container) await loadEntries(container);
      } catch (err) {
        showError(err.message || '删除失败');
      }
    });
  });
}

function bindScanSettings(container) {
  const settings = { ...DEFAULT_SCAN_SETTINGS, ...(storage.get(SCAN_SETTINGS_KEY, {}) || {}) };

  const updateSetting = (key, value) => {
    settings[key] = value;
    storage.set(SCAN_SETTINGS_KEY, settings);
  };

  container.querySelector('#wi-scan-depth')?.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    const hint = container.querySelector('[data-hint="scanDepth"]');
    if (hint) hint.textContent = `${v} 条消息`;
    updateSetting('scanDepth', v);
  });

  container.querySelector('#wi-budget')?.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    const hint = container.querySelector('[data-hint="budget"]');
    if (hint) hint.textContent = `${v}%`;
    updateSetting('budget', v);
  });

  container.querySelector('#wi-min-act')?.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    const hint = container.querySelector('[data-hint="minActivations"]');
    if (hint) hint.textContent = v;
    updateSetting('minActivations', v);
  });

  ['wi-recursive', 'wi-case-sensitive', 'wi-whole-words'].forEach((id) => {
    const key = id === 'wi-recursive' ? 'recursive' : id === 'wi-case-sensitive' ? 'caseSensitive' : 'matchWholeWords';
    container.querySelector(`#${id}`)?.addEventListener('change', (e) => {
      updateSetting(key, e.target.checked);
    });
  });
}

async function showWorldbookForm(worldbook = null) {
  const isEdit = !!worldbook;
  const wb = worldbook || {};

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <label class="form-group__label">世界书名称 *</label>
        <mdui-text-field variant="outlined" id="wb-name" value="${escapeHtml(wb.name || '')}" placeholder="如：奇幻世界设定" required></mdui-text-field>
      </div>
      <div class="form-group">
        <mdui-text-field id="wb-description" label="描述（可选）" variant="outlined" rows="3" autosize max-rows="10" placeholder="世界书的简要描述" value="${escapeHtml(wb.description || '')}"></mdui-text-field>
      </div>
    </div>
  `;

  await showModal({
    title: isEdit ? '编辑世界书' : '新建世界书',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isEdit ? '保存' : '创建', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const name = dialog.querySelector('#wb-name').value.trim();
        const description = dialog.querySelector('#wb-description').value;
        if (!name) {
          showError('名称不能为空');
          return;
        }
        try {
          if (isEdit) {
            await worldbookApi.update(wb.id, { name, description });
            showSuccess('已保存');
          } else {
            const created = await worldbookApi.create({ name, description });
            showSuccess('已创建');
            currentWorldbookId = created.id;
          }
          close('saved');
          const container = document.getElementById('cp-content-world-info');
          if (container) {
            await loadWorldbooks(container);
            await loadEntries(container);
          }
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

async function showEntryForm(entry = null) {
  const isEdit = !!entry;
  const e = entry || {};

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <label class="form-group__label">条目备注</label>
        <mdui-text-field variant="outlined" id="entry-comment" value="${escapeHtml(e.comment || '')}" placeholder="条目的简短描述"></mdui-text-field>
      </div>

      <div class="form-group">
        <label class="form-group__label">关键词（逗号分隔，支持正则）</label>
        <mdui-text-field variant="outlined" id="entry-keys" value="${escapeHtml((Array.isArray(e.key) ? e.key : [e.key]).filter(Boolean).join(', '))}" placeholder="如：魔法, 城堡, 龙族"></mdui-text-field>
      </div>

      <div class="form-group">
        <label class="form-group__label">次关键词（可选，逗号分隔）</label>
        <mdui-text-field variant="outlined" id="entry-keys-secondary" value="${escapeHtml((Array.isArray(e.keysecondary) ? e.keysecondary : [e.keysecondary]).filter(Boolean).join(', '))}" placeholder="用于 AND / NOT 逻辑"></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="entry-content" label="内容" variant="outlined" rows="6" autosize max-rows="15" placeholder="被激活时注入到提示词的内容" value="${escapeHtml(e.content || '')}"></mdui-text-field>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">优先级（order）</label>
          <mdui-text-field variant="outlined" type="number" id="entry-order" value="${e.order ?? 100}" min="0" max="1000"></mdui-text-field>
        </div>
        <div class="form-group">
          <label class="form-group__label">注入位置</label>
          <mdui-select id="entry-position" variant="outlined" value="${e.position === 0 ? '0' : e.position === 4 ? '4' : '1'}">
            <mdui-menu-item value="0">系统提示前</mdui-menu-item>
            <mdui-menu-item value="1">系统提示后</mdui-menu-item>
            <mdui-menu-item value="4">聊天指定深度</mdui-menu-item>
          </mdui-select>
        </div>
        <div class="form-group">
          <label class="form-group__label">注入深度</label>
          <mdui-text-field variant="outlined" type="number" id="entry-depth" value="${e.depth ?? 4}" min="0" max="50"></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">激活逻辑</label>
        <mdui-select id="entry-logic" variant="outlined" value="${e.selectiveLogic ?? 0}">
          <mdui-menu-item value="0">AND ANY（任一主关键词 + 任一次关键词）</mdui-menu-item>
          <mdui-menu-item value="1">NOT ALL（任一主关键词且无任何次关键词）</mdui-menu-item>
          <mdui-menu-item value="2">NOT ANY（任一主关键词或次关键词）</mdui-menu-item>
          <mdui-menu-item value="3">AND ALL（所有主关键词 + 所有次关键词）</mdui-menu-item>
        </mdui-select>
      </div>

      <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
        <mdui-switch id="entry-constant" ${e.constant ? 'checked' : ''}></mdui-switch>
        <span style="font-size: 14px;">常驻激活（无需关键词触发，始终注入）</span>
      </label>

      <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
        <mdui-switch id="entry-disable" ${e.disable ? 'checked' : ''}></mdui-switch>
        <span style="font-size: 14px;">禁用此条目</span>
      </label>
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
          comment: dialog.querySelector('#entry-comment').value.trim(),
          key: dialog.querySelector('#entry-keys').value.split(',').map((s) => s.trim()).filter(Boolean),
          keysecondary: dialog.querySelector('#entry-keys-secondary').value.split(',').map((s) => s.trim()).filter(Boolean),
          content: dialog.querySelector('#entry-content').value,
          order: parseInt(dialog.querySelector('#entry-order').value, 10) || 100,
          position: parseInt(dialog.querySelector('#entry-position').value, 10),
          depth: parseInt(dialog.querySelector('#entry-depth').value, 10) || 4,
          selectiveLogic: parseInt(dialog.querySelector('#entry-logic').value, 10),
          constant: dialog.querySelector('#entry-constant').checked,
          disable: dialog.querySelector('#entry-disable').checked,
          selective: true,
        };

        try {
          if (isEdit) {
            await worldbookApi.updateEntry(currentWorldbookId, e.uid, data);
            showSuccess('已保存');
          } else {
            await worldbookApi.addEntry(currentWorldbookId, data);
            showSuccess('已添加');
          }
          close('saved');
          const container = document.getElementById('cp-content-world-info');
          if (container) await loadEntries(container);
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

export default { renderWorldInfo };
