/**
 * 控制面板：正则脚本
 * 管理全局正则和角色正则（回应预设正则）
 */
import appState from '../stores/appState.js';
import { userApi, characterApi } from '../api/index.js';
import { showSuccess, showError } from '../components/Toast.js';
import { confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml } from '../utils/helpers.js';
import { applySingleRegex } from '../utils/regexEngine.js';
import { regexScriptsToSillyTavern } from './responseConfig.js';
import storage from '../utils/storage.js';

const PRESETS_KEY = 'cp_response_presets';
const ACTIVE_PRESET_KEY = 'cp_response_active_preset';

let scripts = [];
let presetScripts = [];
let characterScripts = [];
let loaded = false;
let editingId = null;
let activeContainer = null;

// 监听外部更新事件（如预设切换/导入后触发）
// 延迟执行避免在 mdui 组件活跃时替换 DOM
document.addEventListener('regex-scripts-updated', () => {
  loaded = false;
  if (activeContainer) {
    setTimeout(() => loadScripts(activeContainer), 50);
  }
});

function getUserId() {
  return appState.get('user')?.id;
}

function getCharacterName(charId) {
  const characters = appState.get('characters') || [];
  const c = characters.find((ch) => ch.id === charId);
  return c ? c.name : charId.slice(0, 8);
}

// ============ 渲染 ============
export function renderRegex(container, { force } = {}) {
  if (loaded && !force) return;
  activeContainer = container;

  container.innerHTML = `
    <div class="cp-section">
      <div class="cp-section__header">
        <h3 class="cp-section__title">正则脚本</h3>
        <div class="cp-section__actions">
          <mdui-button variant="outlined" id="regex-add-global" icon="add">新建全局</mdui-button>
          <mdui-button variant="outlined" id="regex-add-char" icon="add">新建角色</mdui-button>
          <mdui-button variant="outlined" id="regex-add-preset" icon="add">新建预设</mdui-button>
        </div>
      </div>
      <p class="cp-section__desc">正则脚本可自动替换 AI 回复显示、用户输入或发送给 LLM 的提示词中的文本模式。</p>
      <div id="regex-list" class="regex-list"></div>
      <div id="regex-preset-section">
        <h3 class="cp-section__title" style="margin-top:16px;font-size:13px;">预设正则（随预设加载/卸载）</h3>
        <div id="regex-preset-list" class="regex-list"></div>
      </div>
      <div id="regex-character-section">
        <h3 class="cp-section__title" style="margin-top:16px;font-size:13px;">角色卡正则（随角色加载/卸载）</h3>
        <div id="regex-character-list" class="regex-list"></div>
      </div>
    </div>
  `;

  container.querySelector('#regex-add-global').addEventListener('click', () => addScript());
  container.querySelector('#regex-add-char').addEventListener('click', () => addCharacterScript());
  container.querySelector('#regex-add-preset').addEventListener('click', () => addPresetScript());

  loadScripts(container);
}

async function loadScripts(container) {
  const userId = getUserId();
  if (!userId) return;
  try {
    scripts = await userApi.getRegexScripts(userId) || [];
    loaded = true;
    renderList(container);
    renderPresetList(container);
    renderCharacterList(container);
  } catch (err) {
    showError(err.message || '加载正则脚本失败');
  }
}

function renderList(container) {
  const listEl = container.querySelector('#regex-list');
  if (!listEl) return;

  if (scripts.length === 0) {
    listEl.innerHTML = '<div class="cp-empty"><div class="cp-empty__desc">暂无自定义正则脚本</div></div>';
    return;
  }

  const sorted = [...scripts].sort((a, b) => a.order - b.order);
  listEl.innerHTML = sorted.map((s) => renderScriptItem(s)).join('');

  // 绑定事件
  listEl.querySelectorAll('.regex-item__toggle').forEach((el) => {
    el.addEventListener('change', async () => {
      const id = el.closest('.regex-item').dataset.id;
      const script = scripts.find((s) => s.id === id);
      if (script) {
        script.enabled = el.checked;
        await saveScripts();
      }
    });
  });

  listEl.querySelectorAll('[data-action="regex-edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.regex-item').dataset.id;
      toggleEditor(id, listEl);
    });
  });

  listEl.querySelectorAll('[data-action="regex-delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.regex-item').dataset.id;
      const ok = await confirm('确定要删除这个正则脚本吗？', '删除');
      if (!ok) return;
      scripts = scripts.filter((s) => s.id !== id);
      await saveScripts();
      renderList(getContainer());
    });
  });

  listEl.querySelectorAll('[data-action="regex-up"]').forEach((btn) => {
    btn.addEventListener('click', () => moveScript(btn.closest('.regex-item').dataset.id, -1));
  });

  listEl.querySelectorAll('[data-action="regex-down"]').forEach((btn) => {
    btn.addEventListener('click', () => moveScript(btn.closest('.regex-item').dataset.id, 1));
  });
}

/** 渲染预设正则脚本（可编辑，保存回预设对象） */
function renderPresetList(container) {
  const section = container.querySelector('#regex-preset-section');
  const listEl = container.querySelector('#regex-preset-list');
  if (!section || !listEl) return;

  presetScripts = appState.get('presetRegexScripts') || [];
  if (presetScripts.length === 0) {
    listEl.innerHTML = '<div class="cp-empty"><div class="cp-empty__desc">当前预设无正则脚本，点击“新建预设”添加</div></div>';
    return;
  }

  const sorted = [...presetScripts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  listEl.innerHTML = sorted.map((s) => renderScriptItem(s, '预设')).join('');

  // 绑定事件
  listEl.querySelectorAll('.regex-item__toggle').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.closest('.regex-item').dataset.id;
      const script = presetScripts.find((s) => s.id === id);
      if (script) {
        script.enabled = el.checked;
        savePresetScripts();
      }
    });
  });

  listEl.querySelectorAll('[data-action="regex-edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.regex-item').dataset.id;
      toggleEditor(id, listEl, presetScripts, savePresetScriptsAndRender);
    });
  });

  listEl.querySelectorAll('[data-action="regex-delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.regex-item').dataset.id;
      const ok = await confirm('确定要删除这个预设正则脚本吗？', '删除');
      if (!ok) return;
      presetScripts = presetScripts.filter((s) => s.id !== id);
      savePresetScripts();
      renderPresetList(getContainer());
    });
  });

  listEl.querySelectorAll('[data-action="regex-up"]').forEach((btn) => {
    btn.addEventListener('click', () => movePresetScript(btn.closest('.regex-item').dataset.id, -1));
  });

  listEl.querySelectorAll('[data-action="regex-down"]').forEach((btn) => {
    btn.addEventListener('click', () => movePresetScript(btn.closest('.regex-item').dataset.id, 1));
  });
}

/** 保存预设正则到预设对象（localStorage）并同步 appState */
function savePresetScripts() {
  appState.set('presetRegexScripts', presetScripts);
  const presets = storage.get(PRESETS_KEY, []);
  const activeName = storage.get(ACTIVE_PRESET_KEY, 'Default');
  const preset = presets.find((p) => p.name === activeName);
  if (preset) {
    preset.regexScripts = presetScripts;
    storage.set(PRESETS_KEY, presets);
  }
}

function savePresetScriptsAndRender() {
  savePresetScripts();
  renderPresetList(getContainer());
}

function movePresetScript(id, direction) {
  const sorted = [...presetScripts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = sorted.findIndex((s) => s.id === id);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= sorted.length) return;
  const tempOrder = sorted[idx].order ?? idx;
  sorted[idx].order = sorted[targetIdx].order ?? targetIdx;
  sorted[targetIdx].order = tempOrder;
  savePresetScripts();
  renderPresetList(getContainer());
}

/** 渲染角色卡内嵌正则脚本（可编辑，保存回角色卡 extensions.regex_scripts） */
function renderCharacterList(container) {
  const section = container.querySelector('#regex-character-section');
  const listEl = container.querySelector('#regex-character-list');
  if (!section || !listEl) return;

  const conv = appState.get('currentConversation');
  const characters = appState.get('characters') || [];
  const character = conv?.characterId
    ? characters.find((c) => c.id === conv.characterId)
    : null;

  if (!character) {
    listEl.innerHTML = '<div class="cp-empty"><div class="cp-empty__desc">请先打开一个角色对话，角色卡正则随当前角色加载/卸载</div></div>';
    return;
  }

  characterScripts = appState.get('characterRegexScripts') || [];
  if (characterScripts.length === 0) {
    listEl.innerHTML = `<div class="cp-empty"><div class="cp-empty__desc">角色卡「${escapeHtml(character.name)}」未内嵌正则脚本，点击“新建角色”添加</div></div>`;
    return;
  }

  const sorted = [...characterScripts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  listEl.innerHTML = sorted.map((s) => renderScriptItem(s, '角色卡')).join('');

  // 绑定事件
  listEl.querySelectorAll('.regex-item__toggle').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.closest('.regex-item').dataset.id;
      const script = characterScripts.find((s) => s.id === id);
      if (script) {
        script.enabled = el.checked;
        saveCharacterScripts();
      }
    });
  });

  listEl.querySelectorAll('[data-action="regex-edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.regex-item').dataset.id;
      toggleEditor(id, listEl, characterScripts, saveCharacterScriptsAndRender);
    });
  });

  listEl.querySelectorAll('[data-action="regex-delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.regex-item').dataset.id;
      const ok = await confirm('确定要删除这个角色卡正则脚本吗？', '删除');
      if (!ok) return;
      characterScripts = characterScripts.filter((s) => s.id !== id);
      saveCharacterScripts();
      renderCharacterList(getContainer());
    });
  });

  listEl.querySelectorAll('[data-action="regex-up"]').forEach((btn) => {
    btn.addEventListener('click', () => moveCharacterScript(btn.closest('.regex-item').dataset.id, -1));
  });

  listEl.querySelectorAll('[data-action="regex-down"]').forEach((btn) => {
    btn.addEventListener('click', () => moveCharacterScript(btn.closest('.regex-item').dataset.id, 1));
  });
}

/** 保存角色卡正则到角色卡 extensions.regex_scripts（后端持久化）并同步 appState */
function saveCharacterScripts() {
  const conv = appState.get('currentConversation');
  const charId = conv?.characterId;
  if (!charId) return;
  const characters = appState.get('characters') || [];
  const character = characters.find((c) => c.id === charId);
  if (!character) return;

  // 内部格式 → SillyTavern 格式，写回角色卡
  const extensions = { ...(character.extensions || {}), regex_scripts: regexScriptsToSillyTavern(characterScripts) };
  character.extensions = extensions;
  appState.set('characters', characters);
  appState.set('characterRegexScripts', characterScripts);

  characterApi.update(charId, { extensions }).catch((err) => {
    showError(err.message || '保存角色卡正则失败');
  });
}

function saveCharacterScriptsAndRender() {
  saveCharacterScripts();
  renderCharacterList(getContainer());
}

function moveCharacterScript(id, direction) {
  const sorted = [...characterScripts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = sorted.findIndex((s) => s.id === id);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= sorted.length) return;
  const tempOrder = sorted[idx].order ?? idx;
  sorted[idx].order = sorted[targetIdx].order ?? targetIdx;
  sorted[targetIdx].order = tempOrder;
  saveCharacterScripts();
  renderCharacterList(getContainer());
}

function renderScriptItem(s, scopeOverride) {
  const scopeLabel = scopeOverride || (s.scope === 'global' ? '全局' : `角色: ${escapeHtml(getCharacterName(s.scope))}`);
  const affectsLabel = [
    s.affects?.display ? '显示' : null,
    s.affects?.userInput ? '输入' : null,
    s.affects?.prompt ? '提示词' : null,
  ].filter(Boolean).join(' / ') || '无';

  return `
    <div class="regex-item ${s.enabled ? '' : 'regex-item--disabled'}" data-id="${s.id}">
      <div class="regex-item__row">
        <mdui-switch class="regex-item__toggle" ${s.enabled ? 'checked' : ''}></mdui-switch>
        <div class="regex-item__info">
          <span class="regex-item__name">${escapeHtml(s.name)}</span>
          <span class="regex-item__meta">${scopeLabel} · ${affectsLabel}</span>
        </div>
        <div class="regex-item__actions">
          <button class="message__action-btn" data-action="regex-up" title="上移">${getIcon('arrowUpward', 16)}</button>
          <button class="message__action-btn" data-action="regex-down" title="下移">${getIcon('arrowDownward', 16)}</button>
          <button class="message__action-btn" data-action="regex-edit" title="编辑">${getIcon('edit', 16)}</button>
          <button class="message__action-btn" data-action="regex-delete" title="删除">${getIcon('delete', 16)}</button>
        </div>
      </div>
      <div class="regex-editor" id="regex-editor-${s.id}" style="display:none;"></div>
    </div>
  `;
}

// ============ 编辑器 ============
function toggleEditor(id, listEl, scriptArray, onSave) {
  const editorEl = listEl.querySelector(`#regex-editor-${id}`);
  if (!editorEl) return;

  if (editingId === id) {
    editorEl.style.display = 'none';
    editingId = null;
    return;
  }

  // 关闭之前的编辑器
  if (editingId) {
    const prev = listEl.querySelector(`#regex-editor-${editingId}`);
    if (prev) prev.style.display = 'none';
  }

  editingId = id;
  const arr = scriptArray || scripts;
  const script = arr.find((s) => s.id === id);
  if (!script) return;

  editorEl.style.display = 'block';
  editorEl.innerHTML = renderEditorForm(script);
  bindEditorEvents(editorEl, script, onSave);
}

function renderEditorForm(s) {
  return `
    <div class="regex-editor__form">
      <mdui-text-field label="名称" value="${escapeHtml(s.name)}" class="regex-field" data-field="name"></mdui-text-field>
      <mdui-text-field label="查找正则" value="${escapeHtml(s.findRegex)}" class="regex-field" data-field="findRegex"
        placeholder="/pattern/flags 或纯 pattern"></mdui-text-field>
      <mdui-text-field label="替换为" value="${escapeHtml(s.replaceWith)}" class="regex-field" data-field="replaceWith"
        placeholder="支持 {{match}}, $1-$9"></mdui-text-field>
      <mdui-text-field label="修剪内容（可选）" value="${escapeHtml(s.trimOut || '')}" class="regex-field" data-field="trimOut"
        placeholder="每行一个，从匹配中先移除"></mdui-text-field>
      <div class="regex-editor__checkboxes">
        <label class="regex-checkbox"><mdui-checkbox data-field="affect_display" ${s.affects?.display ? 'checked' : ''}></mdui-checkbox> AI 回复显示</label>
        <label class="regex-checkbox"><mdui-checkbox data-field="affect_userInput" ${s.affects?.userInput ? 'checked' : ''}></mdui-checkbox> 用户输入</label>
        <label class="regex-checkbox"><mdui-checkbox data-field="affect_prompt" ${s.affects?.prompt ? 'checked' : ''}></mdui-checkbox> 提示词</label>
      </div>
      <div class="regex-editor__depth">
        <mdui-text-field label="最小深度" type="number" value="${s.minDepth ?? ''}" class="regex-field-half" data-field="minDepth"
          placeholder="不限"></mdui-text-field>
        <mdui-text-field label="最大深度" type="number" value="${s.maxDepth ?? ''}" class="regex-field-half" data-field="maxDepth"
          placeholder="不限"></mdui-text-field>
      </div>
      <div class="regex-editor__test">
        <mdui-text-field label="测试输入" class="regex-field" data-field="testInput" placeholder="输入文本测试正则效果"></mdui-text-field>
        <div class="regex-test-output" data-field="testOutput">输出将显示在这里</div>
      </div>
      <div class="regex-editor__actions">
        <mdui-button variant="filled" data-action="regex-save">保存</mdui-button>
        <mdui-button variant="text" data-action="regex-cancel">取消</mdui-button>
      </div>
    </div>
  `;
}

function bindEditorEvents(editorEl, script, onSave) {
  // 实时测试
  const testInput = editorEl.querySelector('[data-field="testInput"]');
  const testOutput = editorEl.querySelector('[data-field="testOutput"]');
  const findField = editorEl.querySelector('[data-field="findRegex"]');
  const replaceField = editorEl.querySelector('[data-field="replaceWith"]');
  const trimField = editorEl.querySelector('[data-field="trimOut"]');

  const runTest = () => {
    const input = testInput?.value || '';
    if (!input) { testOutput.textContent = '输出将显示在这里'; return; }
    const testScript = {
      findRegex: findField?.value || '',
      replaceWith: replaceField?.value || '',
      trimOut: trimField?.value || '',
    };
    try {
      const result = applySingleRegex(input, testScript);
      testOutput.textContent = result;
    } catch {
      testOutput.textContent = '(正则表达式无效)';
    }
  };

  testInput?.addEventListener('input', runTest);
  findField?.addEventListener('input', runTest);
  replaceField?.addEventListener('input', runTest);
  trimField?.addEventListener('input', runTest);

  // 保存
  editorEl.querySelector('[data-action="regex-save"]').addEventListener('click', async () => {
    script.name = editorEl.querySelector('[data-field="name"]').value || '未命名';
    script.findRegex = findField?.value || '';
    script.replaceWith = replaceField?.value || '';
    script.trimOut = trimField?.value || '';
    script.affects = {
      display: editorEl.querySelector('[data-field="affect_display"]').checked,
      userInput: editorEl.querySelector('[data-field="affect_userInput"]').checked,
      prompt: editorEl.querySelector('[data-field="affect_prompt"]').checked,
    };
    const minD = editorEl.querySelector('[data-field="minDepth"]').value;
    const maxD = editorEl.querySelector('[data-field="maxDepth"]').value;
    script.minDepth = minD !== '' ? parseInt(minD, 10) : undefined;
    script.maxDepth = maxD !== '' ? parseInt(maxD, 10) : undefined;

    if (onSave) {
      onSave();
    } else {
      await saveScripts();
      renderList(getContainer());
    }
    editingId = null;
    showSuccess('已保存');
  });

  // 取消
  editorEl.querySelector('[data-action="regex-cancel"]').addEventListener('click', () => {
    editingId = null;
    editorEl.style.display = 'none';
  });
}

// ============ 操作 ============
async function addScript() {
  const userId = getUserId();
  if (!userId) return;

  const newScript = {
    id: crypto.randomUUID(),
    name: '新正则脚本',
    findRegex: '',
    replaceWith: '',
    trimOut: '',
    enabled: true,
    affects: { display: true, userInput: false, prompt: false },
    scope: 'global',
    minDepth: undefined,
    maxDepth: undefined,
    order: scripts.length,
  };

  scripts.push(newScript);
  await saveScripts();
  renderList(getContainer());

  // 自动打开编辑器
  setTimeout(() => {
    const listEl = getContainer()?.querySelector('#regex-list');
    if (listEl) toggleEditor(newScript.id, listEl);
  }, 50);
}

/** 新建角色卡正则：写入当前对话角色卡的 extensions.regex_scripts */
function addCharacterScript() {
  const conv = appState.get('currentConversation');
  const characters = appState.get('characters') || [];
  const character = conv?.characterId
    ? characters.find((c) => c.id === conv.characterId)
    : null;
  if (!character) {
    showError('请先打开一个角色对话再创建角色卡正则');
    return;
  }

  // 确保与 appState 同步（可能尚未渲染过角色区域）
  characterScripts = appState.get('characterRegexScripts') || [];

  const newScript = {
    id: 'regex_char_' + Date.now(),
    name: '新角色卡正则',
    findRegex: '',
    replaceWith: '',
    trimOut: '',
    enabled: true,
    affects: { display: true, userInput: false, prompt: false },
    scope: character.id,
    minDepth: undefined,
    maxDepth: undefined,
    order: characterScripts.length,
  };

  characterScripts.push(newScript);
  saveCharacterScripts();
  renderCharacterList(getContainer());

  // 自动打开编辑器
  setTimeout(() => {
    const listEl = getContainer()?.querySelector('#regex-character-list');
    if (listEl) toggleEditor(newScript.id, listEl, characterScripts, saveCharacterScriptsAndRender);
  }, 50);
}

function addPresetScript() {
  const newScript = {
    id: 'regex_preset_' + Date.now(),
    name: '新预设正则',
    findRegex: '',
    replaceWith: '',
    trimOut: '',
    enabled: true,
    affects: { display: true, userInput: false, prompt: false },
    scope: 'global',
    minDepth: undefined,
    maxDepth: undefined,
    order: presetScripts.length,
  };

  presetScripts.push(newScript);
  savePresetScripts();
  renderPresetList(getContainer());

  // 自动打开编辑器
  setTimeout(() => {
    const listEl = getContainer()?.querySelector('#regex-preset-list');
    if (listEl) toggleEditor(newScript.id, listEl, presetScripts, savePresetScriptsAndRender);
  }, 50);
}

async function moveScript(id, direction) {
  const sorted = [...scripts].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((s) => s.id === id);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= sorted.length) return;

  // 交换 order
  const tempOrder = sorted[idx].order;
  sorted[idx].order = sorted[targetIdx].order;
  sorted[targetIdx].order = tempOrder;

  await saveScripts();
  renderList(getContainer());
}

async function saveScripts() {
  const userId = getUserId();
  if (!userId) return;
  try {
    scripts = await userApi.saveRegexScripts(userId, scripts);
    // 同步到 appState 供 chat.js 使用
    appState.set('regexScripts', scripts);
  } catch (err) {
    showError(err.message || '保存失败');
  }
}

function getContainer() {
  return document.getElementById('cp-content-regex');
}
