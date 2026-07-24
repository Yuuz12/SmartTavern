/**
 * 模块 8: 角色
 * 角色列表 + 创建/编辑/删除
 */
import appState from '../stores/appState.js';
import { characterApi, worldbookApi, conversationApi } from '../api/index.js';
import { showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml, truncate, readFileAsJson, downloadFile, debounce, formatRelativeTime } from '../utils/helpers.js';

let allCharacters = [];
let allWorldbooks = [];
let searchKeyword = '';

/**
 * 渲染角色模块
 */
export async function renderCharacters(container, opts = {}) {
  container.innerHTML = `
    <div class="cp-toolbar">
      <mdui-text-field id="cp-char-search" class="cp-toolbar__search" variant="outlined" placeholder="搜索角色..." value="${escapeHtml(searchKeyword)}"></mdui-text-field>
      <mdui-button variant="filled" id="cp-add-char" icon="add">新建角色</mdui-button>
      <mdui-button-icon icon="upload" id="cp-import-char" label="导入角色卡"></mdui-button-icon>
      <mdui-button-icon icon="refresh" id="cp-refresh-char" label="刷新"></mdui-button-icon>
    </div>
    <input type="file" id="cp-char-file-input" accept=".json,.png" style="display: none;" />
    <div id="cp-char-grid">
      <div class="cp-empty">
        <mdui-circular-progress style="margin: 0 auto;"></mdui-circular-progress>
      </div>
    </div>
  `;

  // 绑定事件
  const searchInput = container.querySelector('#cp-char-search');
  searchInput?.addEventListener('input', debounce(() => {
    searchKeyword = searchInput.value.trim();
    renderGrid(container);
  }, 300));

  container.querySelector('#cp-add-char')?.addEventListener('click', () => showCharacterForm());
  container.querySelector('#cp-refresh-char')?.addEventListener('click', () => loadList(container));

  // 导入
  const fileInput = container.querySelector('#cp-char-file-input');
  container.querySelector('#cp-import-char')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await readFileAsJson(file);
      await characterApi.import(data);
      showSuccess('导入成功');
      await loadList(container);
    } catch (err) {
      showError(err.message || '导入失败');
    }
    fileInput.value = '';
  });

  await loadList(container);
}

async function loadList(container) {
  const gridEl = container.querySelector('#cp-char-grid');
  try {
    const [chars, wbs] = await Promise.all([
      characterApi.list(searchKeyword ? { search: searchKeyword } : undefined),
      worldbookApi.list(),
    ]);
    allCharacters = chars;
    allWorldbooks = wbs;
    appState.set('characters', allCharacters);
    appState.set('worldbooks', allWorldbooks);
    renderGrid(container);
  } catch (err) {
    showError(err.message || '加载角色卡失败');
    gridEl.innerHTML = `<div class="cp-empty"><div class="cp-empty__title">加载失败</div><div class="cp-empty__desc">${escapeHtml(err.message || '')}</div></div>`;
  }
}

function renderGrid(container) {
  const gridEl = container.querySelector('#cp-char-grid');
  const filtered = searchKeyword
    ? allCharacters.filter((c) => (c.name || '').toLowerCase().includes(searchKeyword.toLowerCase()) || (c.description || '').toLowerCase().includes(searchKeyword.toLowerCase()))
    : allCharacters;

  if (!filtered || filtered.length === 0) {
    gridEl.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty__title">${searchKeyword ? '未找到匹配的角色' : '还没有角色卡'}</div>
        <div class="cp-empty__desc">${searchKeyword ? '尝试其他关键词' : '点击"新建角色"创建第一个角色'}</div>
      </div>
    `;
    return;
  }

  const currentConv = appState.get('currentConversation');
  const activeCharId = currentConv?.characterId;

  gridEl.innerHTML = `
    <div class="cp-character-grid">
      ${filtered.map((c) => {
        const avatar = c.avatar
          ? `<img src="${c.avatar}" alt="" />`
          : escapeHtml((c.name || '?').charAt(0).toUpperCase());
        return `
          <mdui-card class="cp-character-card ${c.id === activeCharId ? 'cp-character-card--active' : ''}" variant="filled" clickable data-id="${c.id}">
            <div class="cp-character-card__avatar">${avatar}</div>
            <div class="cp-character-card__name">${escapeHtml(c.name || '未命名')}</div>
            <div class="cp-character-card__actions" style="display: flex; gap: 2px; margin-top: 4px;">
              <mdui-button-icon icon="edit" data-action="edit" label="编辑"></mdui-button-icon>
              <mdui-button-icon icon="download" data-action="export" label="导出"></mdui-button-icon>
              <mdui-button-icon icon="delete" data-action="delete" label="删除" style="color: var(--md-sys-color-error);"></mdui-button-icon>
            </div>
          </mdui-card>
        `;
      }).join('')}
    </div>
  `;

  gridEl.querySelectorAll('.cp-character-card').forEach((card) => {
    const id = card.dataset.id;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      // 点击角色卡：打开该角色的对话列表
      showCharacterConversationsDialog(id);
    });

    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const char = allCharacters.find((c) => c.id === id);
        if (!char) return;

        if (action === 'edit') {
          showCharacterForm(char);
        } else if (action === 'export') {
          try {
            const data = await characterApi.export(id);
            downloadFile(JSON.stringify(data, null, 2), `${char.name || 'character'}.json`);
            showSuccess('已导出');
          } catch (err) {
            showError(err.message || '导出失败');
          }
        } else if (action === 'delete') {
          const ok = await confirm(`确定要删除角色「${char.name}」吗？此操作不可恢复。`, '删除角色');
          if (!ok) return;
          try {
            await characterApi.delete(id);
            showSuccess('已删除');
            await loadList(container);
          } catch (err) {
            showError(err.message || '删除失败');
          }
        }
      });
    });
  });
}

async function showCharacterForm(character = null) {
  const isEdit = !!character;
  const c = character || {};

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <mdui-text-field id="char-name" label="角色名 *" variant="outlined" value="${escapeHtml(c.name || '')}" placeholder="如：爱丽丝" required></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="char-avatar" label="头像 URL（可选）" variant="outlined" value="${escapeHtml(c.avatar || '')}" placeholder="https://..."></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="char-description" label="描述" variant="outlined" rows="3" autosize max-rows="10" placeholder="角色的外貌、背景等描述" value="${escapeHtml(c.description || '')}"></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="char-personality" label="性格" variant="outlined" rows="3" autosize max-rows="10" placeholder="角色的性格特点" value="${escapeHtml(c.personality || '')}"></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="char-scenario" label="场景" variant="outlined" rows="3" autosize max-rows="10" placeholder="对话发生的场景" value="${escapeHtml(c.scenario || '')}"></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="char-first-mes" label="首条消息" variant="outlined" rows="3" autosize max-rows="10" placeholder="角色发送的第一条消息" value="${escapeHtml(c.firstMes || '')}"></mdui-text-field>
      </div>

      <div class="form-group">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <label class="form-group__label" style="margin: 0;">备选开场白</label>
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
        <mdui-text-field id="char-mes-example" label="对话示例" variant="outlined" rows="6" autosize max-rows="15" placeholder="示例对话，格式：&#10;{{user}}: 你好&#10;{{char}}: 你好啊！" value="${escapeHtml(c.mesExample || '')}"></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="char-system-prompt" label="系统提示词（覆盖默认）" variant="outlined" rows="3" autosize max-rows="10" placeholder="自定义系统提示词，留空则使用默认" value="${escapeHtml(c.systemPrompt || '')}"></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="char-tags" label="标签（逗号分隔）" variant="outlined" value="${escapeHtml((c.tags || []).join(', '))}" placeholder="原创, 二次元"></mdui-text-field>
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
    title: isEdit ? '编辑角色' : '新建角色',
    content,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isEdit ? '保存' : '创建', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
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

      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const name = dialog.querySelector('#char-name').value.trim();
        if (!name) {
          showError('角色名不能为空');
          return;
        }

        const alternateGreetings = Array.from(dialog.querySelectorAll('#char-alternate-greetings .char-greeting-input'))
          .map((el) => el.value.trim())
          .filter((v) => v.length > 0);

        const data = {
          name,
          avatar: dialog.querySelector('#char-avatar').value.trim() || undefined,
          description: dialog.querySelector('#char-description').value,
          personality: dialog.querySelector('#char-personality').value,
          scenario: dialog.querySelector('#char-scenario').value,
          firstMes: dialog.querySelector('#char-first-mes').value,
          mesExample: dialog.querySelector('#char-mes-example').value,
          systemPrompt: dialog.querySelector('#char-system-prompt').value,
          tags: dialog.querySelector('#char-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
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
          const container = document.getElementById('cp-content-characters');
          if (container) await loadList(container);
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

/**
 * 显示某角色的对话列表 dialog
 * 点击角色卡时触发：列出该角色所有对话，可选中/删除/新建
 */
async function showCharacterConversationsDialog(characterId) {
  const character = allCharacters.find((c) => c.id === characterId);
  if (!character) return;

  // 拉取该角色的对话列表
  let conversations = [];
  try {
    conversations = await conversationApi.list({ characterId });
  } catch (err) {
    showError(err.message || '加载对话列表失败');
    return;
  }

  const listHtml = conversations.length === 0
    ? `<div class="empty-state" style="padding: 24px;"><p class="empty-state__description">该角色还没有对话，点击下方按钮创建</p></div>`
    : conversations.map((conv) => {
        const lastMessage = conv.messages?.[conv.messages.length - 1];
        const preview = lastMessage
          ? truncate(lastMessage.content.replace(/\n/g, ' '), 40)
          : (conv.title || '空对话');
        const time = formatRelativeTime(conv.updatedAt || conv.createdAt);
        return `
          <mdui-list-item
            class="char-conv-item"
            data-id="${conv.id}"
            rounded
            headline="${escapeHtml(conv.title || '未命名对话')}"
            headline-line="1"
          >
            <span slot="description">${escapeHtml(preview)} · ${time}</span>
            <mdui-button-icon
              slot="end-icon"
              icon="delete"
              data-action="delete-conv"
              data-id="${conv.id}"
              label="删除对话"
              style="color: var(--md-sys-color-error);"
            ></mdui-button-icon>
          </mdui-list-item>
        `;
      }).join('');

  const content = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <mdui-button variant="filled" id="char-conv-new" icon="add" full-width>新建对话</mdui-button>
      <mdui-list>${listHtml}</mdui-list>
    </div>
  `;

  await showModal({
    title: `与「${character.name}」的对话`,
    content,
    actions: [{ text: '关闭', value: 'close', type: 'text' }],
    onMount: (dialog, close) => {
      // 新建对话：动态 import chat.js 复用创建流程，预选该角色
      dialog.querySelector('#char-conv-new')?.addEventListener('click', async () => {
        close('new');
        const chatModule = await import('../pages/chat.js');
        chatModule.showCreateConversationModal(characterId);
      });

      // 选中对话
      dialog.querySelectorAll('.char-conv-item').forEach((item) => {
        item.addEventListener('click', async (e) => {
          if (e.target.closest('[data-action="delete-conv"]')) return;
          const id = item.dataset.id;
          close('selected');
          const chatModule = await import('../pages/chat.js');
          await chatModule.selectConversation(id);
        });
      });

      // 删除对话
      dialog.querySelectorAll('[data-action="delete-conv"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const ok = await confirm('确定要删除这个对话吗？此操作不可恢复。', '删除对话');
          if (!ok) return;
          try {
            await conversationApi.delete(id);
            showSuccess('对话已删除');
            // 刷新 dialog 内列表
            const refreshed = await conversationApi.list({ characterId });
            conversations = refreshed;
            const listEl = dialog.querySelector('mdui-list');
            if (listEl) {
              if (refreshed.length === 0) {
                listEl.innerHTML = `<div class="empty-state" style="padding: 24px;"><p class="empty-state__description">该角色还没有对话，点击上方按钮创建</p></div>`;
              } else {
                listEl.innerHTML = refreshed.map((conv) => {
                  const lastMessage = conv.messages?.[conv.messages.length - 1];
                  const preview = lastMessage
                    ? truncate(lastMessage.content.replace(/\n/g, ' '), 40)
                    : (conv.title || '空对话');
                  const time = formatRelativeTime(conv.updatedAt || conv.createdAt);
                  return `
                    <mdui-list-item class="char-conv-item" data-id="${conv.id}" rounded headline="${escapeHtml(conv.title || '未命名对话')}" headline-line="1">
                      <span slot="description">${escapeHtml(preview)} · ${time}</span>
                      <mdui-button-icon slot="end-icon" icon="delete" data-action="delete-conv" data-id="${conv.id}" label="删除对话" style="color: var(--md-sys-color-error);"></mdui-button-icon>
                    </mdui-list-item>
                  `;
                }).join('');
                // 重新绑定（showModal 的 onMount 只执行一次，这里手动绑新元素）
                rebindConvItems(dialog, characterId, close);
              }
            }
          } catch (err) {
            showError(err.message || '删除失败');
          }
        });
      });
    },
  });
}

// 删除后重新绑定对话项事件（避免闭包内重复定义）
function rebindConvItems(dialog, characterId, close) {
  dialog.querySelectorAll('.char-conv-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="delete-conv"]')) return;
      const id = item.dataset.id;
      close('selected');
      const chatModule = await import('../pages/chat.js');
      await chatModule.selectConversation(id);
    });
  });
  dialog.querySelectorAll('[data-action="delete-conv"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const ok = await confirm('确定要删除这个对话吗？此操作不可恢复。', '删除对话');
      if (!ok) return;
      try {
        await conversationApi.delete(id);
        showSuccess('对话已删除');
        const refreshed = await conversationApi.list({ characterId });
        const listEl = dialog.querySelector('mdui-list');
        if (listEl) {
          if (refreshed.length === 0) {
            listEl.innerHTML = `<div class="empty-state" style="padding: 24px;"><p class="empty-state__description">该角色还没有对话，点击上方按钮创建</p></div>`;
          } else {
            listEl.innerHTML = refreshed.map((conv) => {
              const lastMessage = conv.messages?.[conv.messages.length - 1];
              const preview = lastMessage
                ? truncate(lastMessage.content.replace(/\n/g, ' '), 40)
                : (conv.title || '空对话');
              const time = formatRelativeTime(conv.updatedAt || conv.createdAt);
              return `
                <mdui-list-item class="char-conv-item" data-id="${conv.id}" rounded headline="${escapeHtml(conv.title || '未命名对话')}" headline-line="1">
                  <span slot="description">${escapeHtml(preview)} · ${time}</span>
                  <mdui-button-icon slot="end-icon" icon="delete" data-action="delete-conv" data-id="${conv.id}" label="删除对话" style="color: var(--md-sys-color-error);"></mdui-button-icon>
                </mdui-list-item>
              `;
            }).join('');
            rebindConvItems(dialog, characterId, close);
          }
        }
      } catch (err) {
        showError(err.message || '删除失败');
      }
    });
  });
}

export default { renderCharacters };
