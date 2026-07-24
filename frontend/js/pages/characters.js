/**
 * 角色卡管理页逻辑
 */
import { userState } from '../stores/userState.js';
import { themeState } from '../stores/themeState.js';
import appState from '../stores/appState.js';
import { characterApi, worldbookApi } from '../api/index.js';
import { showToast, showSuccess, showError } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { initMduiTheme } from '../utils/mduiTheme.js';
import { escapeHtml, truncate, formatRelativeTime, readFileAsJson, downloadFile, debounce } from '../utils/helpers.js';

let searchKeyword = '';
let allCharacters = [];
let allWorldbooks = [];

async function init() {
  initMduiTheme();
  themeState.init();

  // 检查登录
  const user = await userState.init();
  if (!user) {
    window.location.replace('/pages/login.html');
    return;
  }

  renderThemeIcon();
  bindEvents();
  await Promise.all([
    loadCharacters(),
    loadWorldbooks(),
  ]);

  appState.subscribe('theme', renderThemeIcon);
}

async function loadWorldbooks() {
  try {
    allWorldbooks = await worldbookApi.list();
  } catch (err) {
    allWorldbooks = [];
  }
}

function renderThemeIcon() {
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;
  const current = themeState.getCurrentTheme();
  const iconMap = { system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };
  themeToggle.setAttribute('icon', iconMap[current] || 'brightness_auto');
}

async function loadCharacters() {
  const grid = document.getElementById('character-grid');
  grid.innerHTML = '<div class="mgmt-loading"><mdui-circular-progress></mdui-circular-progress></div>';

  try {
    const list = await characterApi.list(searchKeyword ? { search: searchKeyword } : undefined);
    allCharacters = list;
    renderGrid(list);
  } catch (err) {
    showError(err.message || '加载角色卡失败');
    grid.innerHTML = `<div class="mgmt-empty"><p>${escapeHtml(err.message || '加载失败')}</p></div>`;
  }
}

function renderGrid(characters) {
  const grid = document.getElementById('character-grid');

  if (!characters || characters.length === 0) {
    grid.innerHTML = `
      <div class="mgmt-empty">
        <div class="empty-state__icon">${getIcon('character', 48)}</div>
        <h2 class="empty-state__title">${searchKeyword ? '未找到匹配的角色卡' : '还没有角色卡'}</h2>
        <p class="empty-state__description">${searchKeyword ? '尝试其他关键词' : '点击右上角新建角色卡，或导入 SillyTavern 角色卡'}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = characters.map((c) => {
    const avatar = c.avatar
      ? `<img src="${c.avatar}" alt="" />`
      : escapeHtml((c.name || '?').charAt(0).toUpperCase());
    const tags = (c.tags || []).slice(0, 3).map((t) => `<mdui-chip>${escapeHtml(t)}</mdui-chip>`).join('');
    const description = c.description || '暂无描述';
    const meta = `更新于 ${formatRelativeTime(c.updatedAt || c.createdAt)}`;

    return `
      <div class="character-tile" data-id="${c.id}">
        <div class="character-tile__header">
          <div class="character-tile__avatar">${avatar}</div>
          <div class="character-tile__info">
            <div class="character-tile__name">${escapeHtml(c.name)}</div>
            <div class="character-tile__meta">${meta}</div>
          </div>
        </div>
        <div class="character-tile__body">
          <div class="character-tile__desc">${escapeHtml(truncate(description, 120))}</div>
          ${tags ? `<div class="character-tile__tags">${tags}</div>` : ''}
        </div>
        <div class="character-tile__actions">
          <mdui-button-icon icon="chat" label="对话" data-action="chat"></mdui-button-icon>
          <mdui-button-icon icon="edit" label="编辑" data-action="edit"></mdui-button-icon>
          <mdui-button-icon icon="download" label="导出" data-action="export"></mdui-button-icon>
          <mdui-button-icon icon="delete" label="删除" data-action="delete" style="color: rgb(var(--mdui-color-error));"></mdui-button-icon>
        </div>
      </div>
    `;
  }).join('');

  // 绑定卡片事件
  grid.querySelectorAll('.character-tile').forEach((tile) => {
    const id = tile.dataset.id;
    tile.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        handleAction(action, id);
      });
    });
  });
}

async function handleAction(action, id) {
  const character = allCharacters.find((c) => c.id === id);
  if (!character) return;

  switch (action) {
    case 'chat':
      // 跳转到聊天页并预选角色卡（通过 URL 参数）
      window.location.href = `/pages/chat.html?characterId=${id}`;
      break;
    case 'edit':
      showCharacterForm(character);
      break;
    case 'export':
      try {
        const data = await characterApi.export(id);
        downloadFile(JSON.stringify(data, null, 2), `character-${character.name}.json`);
        showSuccess('已导出');
      } catch (err) {
        showError(err.message || '导出失败');
      }
      break;
    case 'delete':
      const ok = await confirm(`确定要删除角色卡「${character.name}」吗？此操作不可恢复。`, '删除角色卡');
      if (!ok) return;
      try {
        await characterApi.delete(id);
        showSuccess('已删除');
        await loadCharacters();
      } catch (err) {
        showError(err.message || '删除失败');
      }
      break;
  }
}

// ============ 角色卡表单（新建/编辑） ============
async function showCharacterForm(character = null) {
  const isEdit = !!character;
  const c = character || {};

  const content = `
    <div class="mgmt-form">
      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">名称 *</label>
          <mdui-text-field id="char-name" variant="outlined" value="${escapeHtml(c.name || '')}" placeholder="角色名称"></mdui-text-field>
        </div>
        <div class="form-group">
          <label class="form-group__label">创建者</label>
          <mdui-text-field id="char-creator" variant="outlined" value="${escapeHtml(c.creator || '')}" placeholder="作者"></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">头像 URL</label>
        <mdui-text-field id="char-avatar" variant="outlined" value="${escapeHtml(c.avatar || '')}" placeholder="https://..."></mdui-text-field>
      </div>

      <div class="form-group">
        <label class="form-group__label">描述</label>
        <mdui-text-field id="char-description" variant="outlined" rows="4" placeholder="角色的外貌、背景等" value="${escapeHtml(c.description || '')}"></mdui-text-field>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">性格</label>
          <mdui-text-field id="char-personality" variant="outlined" rows="3" placeholder="性格特点" value="${escapeHtml(c.personality || '')}"></mdui-text-field>
        </div>
        <div class="form-group">
          <label class="form-group__label">场景</label>
          <mdui-text-field id="char-scenario" variant="outlined" rows="3" placeholder="对话场景设定" value="${escapeHtml(c.scenario || '')}"></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">首条消息</label>
        <mdui-text-field id="char-first-mes" variant="outlined" rows="3" placeholder="对话开始时 AI 的第一条消息" value="${escapeHtml(c.firstMes || '')}"></mdui-text-field>
      </div>

      <div class="form-group">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <label class="form-group__label">备选开场白</label>
          <mdui-button variant="tonal" id="char-add-greeting-btn" icon="add">添加</mdui-button>
        </div>
        <div id="char-alternate-greetings" style="display: flex; flex-direction: column; gap: 8px;">
          ${(c.alternateGreetings || []).map((g, i) => `
            <div class="char-greeting-row" style="display: flex; gap: 8px; align-items: center;">
              <mdui-text-field variant="outlined" rows="2" class="char-greeting-input" placeholder="备选开场白 ${i + 2}" value="${escapeHtml(g)}" style="flex: 1;"></mdui-text-field>
              <mdui-button-icon icon="delete" class="char-greeting-delete" label="删除" style="color: rgb(var(--mdui-color-error)); flex-shrink: 0;"></mdui-button-icon>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">对话示例</label>
        <mdui-text-field id="char-mes-example" variant="outlined" rows="4" placeholder="示例对话格式" value="${escapeHtml(c.mesExample || '')}"></mdui-text-field>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <label class="form-group__label">系统提示词</label>
          <mdui-text-field id="char-system-prompt" variant="outlined" rows="3" placeholder="覆盖默认系统提示词" value="${escapeHtml(c.systemPrompt || '')}"></mdui-text-field>
        </div>
        <div class="form-group">
          <label class="form-group__label">后置指令</label>
          <mdui-text-field id="char-post-history" variant="outlined" rows="3" placeholder="放在对话历史后的指令" value="${escapeHtml(c.postHistoryInstructions || '')}"></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">标签</label>
        <div class="tag-input-container" id="char-tags-container">
          <input type="text" class="tag-input__input" id="char-tag-input" placeholder="输入后回车添加" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-group__label">绑定世界书</label>
        <div class="char-wb-list" id="char-wb-list">
          ${allWorldbooks.length === 0 ? '<div style="color: rgb(var(--mdui-color-on-surface-variant)); font-size: 13px;">暂无世界书，请先在世界书页面创建</div>' : ''}
          ${allWorldbooks.map((wb) => `
            <mdui-chip
              selectable
              ${((c.worldBookIds || []).includes(wb.id)) ? 'selected' : ''}
              data-wb-id="${wb.id}"
            >${escapeHtml(wb.name)}${wb.entryCount != null ? ` (${wb.entryCount})` : ''}</mdui-chip>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  await showModal({
    title: isEdit ? '编辑角色卡' : '新建角色卡',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isEdit ? '保存' : '创建', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      // 标签输入
      const tagsContainer = dialog.querySelector('#char-tags-container');
      const tagInput = dialog.querySelector('#char-tag-input');
      let tags = [...(c.tags || [])];

      function renderTags() {
        // 保留输入框
        const inputEl = dialog.querySelector('#char-tag-input');
        tagsContainer.innerHTML = tags.map((t, i) => `
          <span class="tag-input__tag">
            ${escapeHtml(t)}
            <button type="button" class="tag-input__remove" data-idx="${i}" aria-label="删除标签">×</button>
          </span>
        `).join('');
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.className = 'tag-input__input';
        newInput.id = 'char-tag-input';
        newInput.placeholder = '输入后回车添加';
        tagsContainer.appendChild(newInput);
        bindTagInput(newInput);

        tagsContainer.querySelectorAll('.tag-input__remove').forEach((btn) => {
          btn.addEventListener('click', () => {
            tags.splice(parseInt(btn.dataset.idx), 1);
            renderTags();
          });
        });
      }

      function bindTagInput(input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && input.value.trim()) {
            e.preventDefault();
            tags.push(input.value.trim());
            input.value = '';
            renderTags();
          } else if (e.key === 'Backspace' && !input.value && tags.length > 0) {
            tags.pop();
            renderTags();
          }
        });
      }

      bindTagInput(tagInput);
      renderTags();

      // 备选开场白：添加/删除
      const greetingsContainer = dialog.querySelector('#char-alternate-greetings');
      dialog.querySelector('#char-add-greeting-btn').addEventListener('click', () => {
        const idx = greetingsContainer.querySelectorAll('.char-greeting-row').length;
        const row = document.createElement('div');
        row.className = 'char-greeting-row';
        row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
        row.innerHTML = `
          <mdui-text-field variant="outlined" rows="2" class="char-greeting-input" placeholder="备选开场白 ${idx + 2}" value="" style="flex: 1;"></mdui-text-field>
          <mdui-button-icon icon="delete" class="char-greeting-delete" label="删除" style="color: rgb(var(--mdui-color-error)); flex-shrink: 0;"></mdui-button-icon>
        `;
        greetingsContainer.appendChild(row);
      });
      greetingsContainer.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.char-greeting-delete');
        if (delBtn) {
          delBtn.closest('.char-greeting-row').remove();
        }
      });

      // 保存
      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const name = dialog.querySelector('#char-name').value.trim();
        if (!name) {
          showError('名称不能为空');
          return;
        }

        const alternateGreetings = Array.from(dialog.querySelectorAll('#char-alternate-greetings .char-greeting-input'))
          .map((el) => el.value.trim())
          .filter((v) => v.length > 0);

        const data = {
          name,
          avatar: dialog.querySelector('#char-avatar').value.trim() || undefined,
          description: dialog.querySelector('#char-description').value.trim() || undefined,
          personality: dialog.querySelector('#char-personality').value.trim() || undefined,
          scenario: dialog.querySelector('#char-scenario').value.trim() || undefined,
          firstMes: dialog.querySelector('#char-first-mes').value.trim() || undefined,
          mesExample: dialog.querySelector('#char-mes-example').value.trim() || undefined,
          systemPrompt: dialog.querySelector('#char-system-prompt').value.trim() || undefined,
          postHistoryInstructions: dialog.querySelector('#char-post-history').value.trim() || undefined,
          creator: dialog.querySelector('#char-creator').value.trim() || undefined,
          tags,
          alternateGreetings,
          worldBookIds: Array.from(dialog.querySelectorAll('#char-wb-list mdui-chip[selected]')).map((chip) => chip.dataset.wbId),
        };

        try {
          if (isEdit) {
            await characterApi.update(c.id, data);
            showSuccess('已保存');
          } else {
            await characterApi.create(data);
            showSuccess('已创建');
          }
          close('saved');
          await loadCharacters();
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

// ============ 导入角色卡 ============
async function handleImport(file) {
  try {
    const data = await readFileAsJson(file);
    await characterApi.import(data);
    showSuccess('角色卡导入成功');
    await loadCharacters();
  } catch (err) {
    showError(err.message || '导入失败，请检查文件格式');
  }
}

// ============ 事件绑定 ============
function bindEvents() {
  // 返回
  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = '/pages/chat.html';
  });

  // 主题切换
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = themeState.getCurrentTheme();
    const next = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
    themeState.applyTheme(next);
    renderThemeIcon();
  });

  // 搜索（mdui-text-field 的 input 事件）
  document.getElementById('search-input').addEventListener('input', debounce((e) => {
    searchKeyword = (e.target.value || '').trim();
    loadCharacters();
  }, 300));

  // 新建
  document.getElementById('create-btn').addEventListener('click', () => showCharacterForm());

  // 导入
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
