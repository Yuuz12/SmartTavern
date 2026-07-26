/**
 * 模块 8: 角色
 * 角色列表 + 创建/编辑/删除
 */
import appState from '../stores/appState.js';
import { characterApi, worldbookApi, conversationApi, fileApi } from '../api/index.js';
import { showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm, prompt } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml, truncate, readFileAsJson, downloadFile, debounce, formatRelativeTime } from '../utils/helpers.js';
import { insertTextChunk, createPlaceholderPng, encodeBase64, extractTextChunk, decodeBase64, isValidPng } from '../utils/pngMeta.js';

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
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'png') {
        const buffer = await file.arrayBuffer();
        if (!isValidPng(buffer)) { showError('无效的 PNG 文件'); return; }
        const charaData = extractTextChunk(buffer, 'chara');
        if (!charaData) { showError('该 PNG 中未找到角色卡数据'); return; }
        const data = JSON.parse(decodeBase64(charaData));
        try {
          const result = await fileApi.uploadCharacterImage(file);
          if (data.data) data.data.avatar = result.url;
          else data.avatar = result.url;
        } catch { /* 头像上传失败不影响导入 */ }
        await characterApi.import(data);
        showSuccess('导入成功（PNG）');
      } else {
        const data = await readFileAsJson(file);
        await characterApi.import(data);
        showSuccess('导入成功');
      }
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
            const choice = await showModal({
              title: '导出角色卡',
              content: '<p style="margin:0;font-size:14px;">选择导出格式：</p>',
              actions: [
                { text: '取消', value: 'cancel', type: 'text' },
                { text: 'JSON', value: 'json', type: 'outlined' },
                { text: 'PNG', value: 'png', type: 'filled' },
              ],
            });
            if (choice === 'json') {
              downloadFile(JSON.stringify(data, null, 2), `${char.name || 'character'}.json`);
              showSuccess('已导出 JSON');
            } else if (choice === 'png') {
              await exportCharacterPng(char, data);
              showSuccess('已导出 PNG');
            }
          } catch (err) {
            showError(err.message || '导出失败');
          }
        } else if (action === 'delete') {
          const ok = await confirm(`确定要删除角色「${char.name}」吗？导入时自带的世界书会一并删除，此操作不可恢复。`, '删除角色');
          if (!ok) return;
          try {
            await characterApi.delete(id);
            if (char.avatar) fileApi.deleteFile(char.avatar).catch(() => {});
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
        <label class="form-group__label">头像</label>
        <div class="avatar-upload" id="char-avatar-upload">
          <div class="avatar-upload__preview" id="char-avatar-preview">
            ${c.avatar ? `<img src="${c.avatar}" alt="" />` : '<span class="avatar-upload__placeholder">点击上传</span>'}
          </div>
          <div class="avatar-upload__actions">
            <mdui-button variant="tonal" id="char-avatar-btn">选择图片</mdui-button>
            ${c.avatar ? '<mdui-button variant="text" id="char-avatar-clear">清除</mdui-button>' : ''}
          </div>
          <input type="file" id="char-avatar-input" accept="image/*" hidden />
          <input type="hidden" id="char-avatar" value="${escapeHtml(c.avatar || '')}" />
        </div>
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
      // 头像上传
      const avatarInput = dialog.querySelector('#char-avatar-input');
      const avatarPreview = dialog.querySelector('#char-avatar-preview');
      const avatarHidden = dialog.querySelector('#char-avatar');
      dialog.querySelector('#char-avatar-btn').addEventListener('click', () => avatarInput.click());
      avatarPreview.addEventListener('click', () => avatarInput.click());
      dialog.querySelector('#char-avatar-clear')?.addEventListener('click', () => {
        if (avatarHidden.value) fileApi.deleteFile(avatarHidden.value).catch(() => {});
        avatarHidden.value = '';
        avatarPreview.innerHTML = '<span class="avatar-upload__placeholder">点击上传</span>';
        dialog.querySelector('#char-avatar-clear')?.remove();
      });
      avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files[0];
        if (!file) return;
        try {
          if (avatarHidden.value) fileApi.deleteFile(avatarHidden.value).catch(() => {});
          const result = await fileApi.uploadCharacterImage(file);
          avatarHidden.value = result.url;
          avatarPreview.innerHTML = `<img src="${result.url}" alt="" />`;
          if (!dialog.querySelector('#char-avatar-clear')) {
            const clearBtn = document.createElement('mdui-button');
            clearBtn.variant = 'text';
            clearBtn.id = 'char-avatar-clear';
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
/** 生成对话项 HTML */
function buildConvItemHtml(conv) {
  const lastMessage = conv.messages?.[conv.messages.length - 1];
  const preview = lastMessage
    ? truncate(lastMessage.content.replace(/\n/g, ' '), 40)
    : (conv.title || '空对话');
  const time = formatRelativeTime(conv.updatedAt || conv.createdAt);
  return `
    <mdui-list-item class="char-conv-item" data-id="${conv.id}" rounded headline="${escapeHtml(conv.title || '未命名对话')}" headline-line="1">
      <span slot="description">${escapeHtml(preview)} · ${time}</span>
      <div slot="end-icon" style="display:flex;align-items:center;gap:2px;">
        <mdui-button-icon icon="download" data-action="export-json" data-id="${conv.id}" label="导出JSONL"></mdui-button-icon>
        <mdui-button-icon icon="article" data-action="export-text" data-id="${conv.id}" label="导出文本"></mdui-button-icon>
        <mdui-button-icon icon="edit" data-action="rename-conv" data-id="${conv.id}" label="重命名"></mdui-button-icon>
        <mdui-button-icon icon="delete" data-action="delete-conv" data-id="${conv.id}" label="删除" style="color: var(--md-sys-color-error);"></mdui-button-icon>
      </div>
    </mdui-list-item>
  `;
}

/** 导出对话并下载 */
async function downloadConversation(id, format, title) {
  try {
    const response = await conversationApi.export(id, format);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'conversation'}.${format === 'text' ? 'txt' : 'jsonl'}`;
    a.click();
    URL.revokeObjectURL(url);
    showSuccess('导出成功');
  } catch (err) {
    showError(err.message || '导出失败');
  }
}

async function showCharacterConversationsDialog(characterId) {
  const character = allCharacters.find((c) => c.id === characterId);
  if (!character) return;

  let conversations = [];
  try {
    conversations = await conversationApi.list({ characterId });
  } catch (err) {
    showError(err.message || '加载对话列表失败');
    return;
  }

  const renderList = (list) => list.length === 0
    ? `<div class="empty-state" style="padding: 24px;"><p class="empty-state__description">该角色还没有对话</p></div>`
    : list.map(buildConvItemHtml).join('');

  const content = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="display:flex;gap:8px;">
        <mdui-button variant="filled" id="char-conv-new" icon="add" style="flex:1;">新建对话</mdui-button>
        <mdui-button variant="outlined" id="char-conv-import" icon="upload">导入对话</mdui-button>
      </div>
      <mdui-list id="char-conv-list">${renderList(conversations)}</mdui-list>
    </div>
  `;

  await showModal({
    title: `与「${character.name}」的对话`,
    content,
    actions: [{ text: '关闭', value: 'close', type: 'text' }],
    onMount: (dialog, close) => {
      const refreshList = async () => {
        const refreshed = await conversationApi.list({ characterId });
        conversations = refreshed;
        const listEl = dialog.querySelector('#char-conv-list');
        if (listEl) {
          listEl.innerHTML = renderList(refreshed);
          bindConvEvents();
        }
      };

      const bindConvEvents = () => {
        // 选中对话
        dialog.querySelectorAll('.char-conv-item').forEach((item) => {
          item.addEventListener('click', async (e) => {
            if (e.target.closest('[data-action]')) return;
            const id = item.dataset.id;
            close('selected');
            const chatModule = await import('../pages/chat.js');
            await chatModule.selectConversation(id);
          });
        });
        // 导出 JSON
        dialog.querySelectorAll('[data-action="export-json"]').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const conv = conversations.find((c) => c.id === id);
            await downloadConversation(id, 'json', conv?.title);
          });
        });
        // 导出文本
        dialog.querySelectorAll('[data-action="export-text"]').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const conv = conversations.find((c) => c.id === id);
            await downloadConversation(id, 'text', conv?.title);
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
              await refreshList();
            } catch (err) {
              showError(err.message || '删除失败');
            }
          });
        });
        // 重命名对话
        dialog.querySelectorAll('[data-action="rename-conv"]').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const conv = conversations.find((c) => c.id === id);
            const newTitle = await prompt('请输入新的对话标题', conv?.title || '', '重命名对话');
            if (newTitle === null) return;
            try {
              await conversationApi.update(id, { title: newTitle });
              showSuccess('重命名成功');
              await refreshList();
            } catch (err) {
              showError(err.message || '重命名失败');
            }
          });
        });
      };

      // 新建对话
      dialog.querySelector('#char-conv-new')?.addEventListener('click', async () => {
        close('new');
        const chatModule = await import('../pages/chat.js');
        chatModule.showCreateConversationModal(characterId);
      });

      // 导入对话
      dialog.querySelector('#char-conv-import')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.jsonl,application/json';
        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return;
          try {
            const text = await file.text();
            const fileName = file.name.replace(/\.(jsonl?|txt)$/i, '');
            await conversationApi.import(characterId, text, undefined, fileName || undefined);
            showSuccess('对话导入成功');
            await refreshList();
          } catch (err) {
            showError(err.message || '导入失败');
          }
        };
        input.click();
      });

      bindConvEvents();
    },
  });
}

// ============ 导出 PNG ============
async function exportCharacterPng(character, exportData) {
  let pngBuffer;
  if (character.avatar) {
    try {
      const resp = await fetch(character.avatar);
      if (!resp.ok) throw new Error('fetch failed');
      const blob = await resp.blob();
      if (blob.type === 'image/png') {
        pngBuffer = await blob.arrayBuffer();
      } else {
        pngBuffer = await convertImageToPng(character.avatar);
      }
    } catch {
      pngBuffer = await createPlaceholderPng(400, 400, '#6750A4');
    }
  } else {
    pngBuffer = await createPlaceholderPng(400, 400, '#6750A4');
  }
  const jsonStr = JSON.stringify(exportData);
  const b64 = encodeBase64(jsonStr);
  const resultBuffer = insertTextChunk(pngBuffer, 'chara', b64);
  const blob = new Blob([resultBuffer], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${character.name || 'character'}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

async function convertImageToPng(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        resolve(await blob.arrayBuffer());
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

export default { renderCharacters };
