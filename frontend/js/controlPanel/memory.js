/**
 * 记忆模块
 * 控制对话总结、上下文截断、记忆注入
 * 设置和总结存储在 conv.settings 中（每对话独立），通过 API 实时读写
 */
import appState from '../stores/appState.js';
import { conversationApi } from '../api/index.js';
import { showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { escapeHtml, formatRelativeTime, debounce } from '../utils/helpers.js';

// ============ 默认配置 ============

const DEFAULT_MEMORY_SETTINGS = {
  enabled: false,
  maxContextFloors: 30,
  summaryInterval: 10,
  recentSummaryCount: 3,
  categories: [
    {
      id: 'plot',
      name: '剧情总结',
      type: 'summary',
      prompt:
        '请总结以下对话的剧情发展，用简洁的叙述体书写。包括：\n- 关键情节转折与推进\n- 角色间关系的最新变化\n- 当前的主要目标与未解决的冲突\n控制在 200 字以内，聚焦于推动剧情发展的核心信息，忽略无关细节。',
      enabled: true,
      builtin: true,
    },
    {
      id: 'events',
      name: '重要事件',
      type: 'todo',
      prompt:
        '请根据对话内容，维护一份重要事件 TODO 列表。\n\n重要事件包括但不限于：\n- 战斗、追逐、冲突等动作事件\n- 重大发现、决定、承诺\n- 意外遭遇、角色登场/退场\n- 物品获取或丢失\n\n规则：\n- 根据对话内容添加新的重要事件（用 [ ] 标记未完成）\n- 如果对话中某事件已经完成或解决，将其标记为 [x]\n- 保留之前已完成的事件（保持 [x] 标记）\n- 每条事件用一句话简述\n- 按时间顺序排列，最多保留 20 条\n- 直接输出更新后的完整 TODO 列表，不要添加额外说明\n\n格式：\n- [x] 已完成的事件\n- [ ] 未完成的事件',
      enabled: true,
      builtin: true,
    },
    {
      id: 'characters',
      name: '重要人物',
      type: 'tracking',
      prompt:
        '请根据对话内容，维护一份重要人物状态列表。\n\n对于每位人物，记录：\n- 身份/称谓\n- 与主角的关系\n- 最新状态（位置、处境、情绪等）\n\n规则：\n- 根据对话添加新出现的重要人物\n- 更新现有人物的最新状态\n- 如果人物已离场，在状态中标注"已离场"\n- 如果人物已死亡，在状态中标注"已死亡"\n- 保留所有已出现的重要人物\n- 直接输出更新后的完整列表，不要添加额外说明\n\n格式：\n【人物名】身份 - 与主角关系 - 最新状态',
      enabled: true,
      builtin: true,
    },
  ],
};

// ============ 状态 ============

let currentMemory = null;
let currentSummaries = [];
let currentMessageCount = 0;
let isGenerating = false;

// ============ 辅助函数 ============

function getConvId() {
  const conv = appState.get('currentConversation');
  return conv?.id || null;
}

// 防抖保存记忆设置
const debouncedSaveSettings = debounce(async (memory) => {
  const convId = getConvId();
  if (!convId) return;
  try {
    await conversationApi.updateMemory(convId, memory);
    // 同步更新 appState 中的对话
    const conv = appState.get('currentConversation');
    if (conv) {
      conv.settings = { ...conv.settings, memory };
      appState.set('currentConversation', conv);
    }
  } catch (err) {
    showError(err.message || '保存记忆设置失败');
  }
}, 300);

async function saveSettings(memory) {
  currentMemory = memory;
  debouncedSaveSettings(memory);
}

// ============ 主渲染函数 ============

export async function renderMemory(container, opts = {}) {
  const convId = getConvId();
  if (!convId) {
    container.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty__title">请先选择对话</div>
        <div class="cp-empty__desc">记忆功能需要绑定到具体对话</div>
      </div>`;
    return;
  }

  // 加载中状态
  container.innerHTML = `
    <div style="display: flex; justify-content: center; padding: 32px;">
      <mdui-circular-progress></mdui-circular-progress>
    </div>`;

  try {
    const res = await conversationApi.getMemory(convId);
    currentMemory = res?.memory || { ...DEFAULT_MEMORY_SETTINGS };
    currentSummaries = res?.summaries || [];
    currentMessageCount = res?.messageCount || 0;
  } catch (err) {
    container.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty__title">加载失败</div>
        <div class="cp-empty__desc">${escapeHtml(err.message || '无法加载记忆设置')}</div>
      </div>`;
    return;
  }

  renderContent(container);
}

function renderContent(container) {
  const m = currentMemory;
  container.innerHTML = `
    <div class="cp-toolbar">
      <span class="cp-toolbar__title">记忆管理</span>
      <mdui-button variant="outlined" id="cp-memory-generate" icon="auto_awesome"
        ${!m.enabled ? 'disabled' : ''}>立即总结</mdui-button>
      <mdui-button-icon icon="refresh" id="cp-memory-refresh" label="刷新"></mdui-button-icon>
    </div>

    <!-- 区域 1: 基本设置 -->
    <div class="cp-section">
      <h3 class="cp-section__title">基本设置</h3>
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">启用记忆功能</div>
          <div class="cp-switch-row__desc">开启后将自动总结对话并截断旧消息以减少 token 消耗</div>
        </div>
        <mdui-switch id="memory-enabled" ${m.enabled ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-field">
        <label class="cp-field__label">总结用 LLM</label>
        <mdui-select id="memory-llm-select" variant="outlined" value="${escapeHtml(m.llmConfigId || '')}">
          <mdui-menu-item value="">跟随对话 LLM</mdui-menu-item>
          ${(appState.get('llmConfigs') || []).map((c) => `<mdui-menu-item value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</mdui-menu-item>`).join('')}
        </mdui-select>
        <div class="cp-field__desc" style="margin-top:4px;">选择用于生成总结的 LLM，留空则使用对话当前的 LLM 配置</div>
      </div>
      <div class="cp-field">
        <div class="cp-field__label">
          <span>最大发送层数</span>
          <span class="cp-field__desc">超过此层数的旧消息不会发送给 LLM，用总结替代。当前对话：${currentMessageCount} 层</span>
          <span class="cp-field__hint" data-hint="maxContextFloors">${m.maxContextFloors}</span>
        </div>
        <div class="cp-slider">
          <mdui-slider data-setting="maxContextFloors" data-scale="1"
            min="10" max="100" step="1" value="${m.maxContextFloors}"></mdui-slider>
        </div>
      </div>
      <div class="cp-field">
        <div class="cp-field__label">
          <span>总结间隔（每 N 层）</span>
          <span class="cp-field__hint" data-hint="summaryInterval">${m.summaryInterval}</span>
        </div>
        <div class="cp-slider">
          <mdui-slider data-setting="summaryInterval" data-scale="1"
            min="5" max="50" step="1" value="${m.summaryInterval}"></mdui-slider>
        </div>
      </div>
      <div class="cp-field">
        <div class="cp-field__label">
          <span>注入总结条数</span>
          <span class="cp-field__desc">每个分类注入最近 N 条总结到系统提示词</span>
          <span class="cp-field__hint" data-hint="recentSummaryCount">${m.recentSummaryCount}</span>
        </div>
        <div class="cp-slider">
          <mdui-slider data-setting="recentSummaryCount" data-scale="1"
            min="1" max="10" step="1" value="${m.recentSummaryCount}"></mdui-slider>
        </div>
      </div>
    </div>

    <!-- 区域 2: 分类配置 -->
    <div class="cp-section">
      <h3 class="cp-section__title">
        总结分类
        <mdui-button-icon icon="add" id="cp-memory-add-category" label="新增分类"
          style="margin-left: auto; --mdui-color-on-button-icon: var(--mdui-color-primary);"></mdui-button-icon>
      </h3>
      <div id="cp-memory-categories"></div>
    </div>

    <!-- 区域 3: 总结卡片 -->
    <div class="cp-section">
      <h3 class="cp-section__title">已生成总结（${currentSummaries.length}）</h3>
      <div id="cp-memory-summaries"></div>
    </div>
  `;

  bindSettingEvents(container);
  renderCategories(container);
  renderSummaryCards(container);
}

// ============ 设置区事件绑定 ============

function bindSettingEvents(container) {
  // 启用开关
  const enableSwitch = container.querySelector('#memory-enabled');
  enableSwitch?.addEventListener('change', () => {
    currentMemory.enabled = enableSwitch.checked;
    saveSettings(currentMemory);
    // 更新生成按钮状态
    const genBtn = container.querySelector('#cp-memory-generate');
    if (genBtn) genBtn.disabled = !enableSwitch.checked;
  });

  // 总结用 LLM 选择
  const llmSelect = container.querySelector('#memory-llm-select');
  llmSelect?.addEventListener('change', () => {
    currentMemory.llmConfigId = llmSelect.value || undefined;
    saveSettings(currentMemory);
  });

  // 滑块
  container.querySelectorAll('mdui-slider[data-setting]').forEach((slider) => {
    const key = slider.dataset.setting;
    const hintEl = container.querySelector(`[data-hint="${key}"]`);
    const scale = parseFloat(slider.dataset.scale || '1');

    slider.labelFormatter = (val) => String(Math.round(val * scale));

    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10) * scale;
      currentMemory[key] = v;
      if (hintEl) hintEl.textContent = v;
    });

    slider.addEventListener('change', () => {
      saveSettings(currentMemory);
    });
  });

  // 刷新按钮
  container.querySelector('#cp-memory-refresh')?.addEventListener('click', () => {
    renderMemory(container, { force: true });
  });

  // 立即总结按钮
  container.querySelector('#cp-memory-generate')?.addEventListener('click', () => {
    handleGenerate(container);
  });

  // 新增分类按钮
  container.querySelector('#cp-memory-add-category')?.addEventListener('click', () => {
    showCategoryForm();
  });
}

// ============ 分类配置区 ============

function renderCategories(container) {
  const listEl = container.querySelector('#cp-memory-categories');
  if (!listEl) return;

  listEl.innerHTML = currentMemory.categories
    .map((cat) => {
      const catType = cat.type || 'summary';
      const typeLabel = catType === 'todo' ? 'TODO' : catType === 'tracking' ? '追踪' : '总结';
      return `
    <div class="cp-switch-row" data-category-id="${escapeHtml(cat.id)}">
      <div style="flex: 1; min-width: 0;">
        <div class="cp-switch-row__label">
          ${escapeHtml(cat.name)}
          <span class="cp-badge cp-badge--info">${typeLabel}</span>
          ${cat.builtin ? '<span class="cp-badge">内置</span>' : ''}
          ${cat.id === 'plot' ? '<span class="cp-badge cp-badge--success">始终开启</span>' : ''}
        </div>
        <div class="cp-switch-row__desc" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(cat.prompt.slice(0, 80))}${cat.prompt.length > 80 ? '...' : ''}
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
        <mdui-button-icon icon="edit" data-action="edit-category" data-id="${escapeHtml(cat.id)}" label="编辑"></mdui-button-icon>
        ${!cat.builtin ? `<mdui-button-icon icon="delete" data-action="delete-category" data-id="${escapeHtml(cat.id)}" label="删除" style="color: var(--mdui-color-error);"></mdui-button-icon>` : ''}
        ${cat.id !== 'plot' ? `<mdui-switch data-action="toggle-category" data-id="${escapeHtml(cat.id)}" ${cat.enabled ? 'checked' : ''}></mdui-switch>` : ''}
      </div>
    </div>
  `;
    })
    .join('');

  // 绑定分类事件
  listEl.querySelectorAll('[data-action="edit-category"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = currentMemory.categories.find((c) => c.id === btn.dataset.id);
      if (cat) showCategoryForm(cat);
    });
  });

  listEl.querySelectorAll('[data-action="delete-category"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirm(`确定删除分类"${btn.dataset.id}"吗？该分类下已生成的总结也会被删除。`, '删除分类');
      if (!ok) return;
      currentMemory.categories = currentMemory.categories.filter((c) => c.id !== btn.dataset.id);
      currentSummaries = currentSummaries.filter((s) => s.categoryId !== btn.dataset.id);
      await saveSettings(currentMemory);
      await saveSummaries();
      renderCategories(container);
      renderSummaryCards(container);
      showSuccess('分类已删除');
    });
  });

  listEl.querySelectorAll('[data-action="toggle-category"]').forEach((sw) => {
    sw.addEventListener('change', () => {
      const cat = currentMemory.categories.find((c) => c.id === sw.dataset.id);
      if (cat) {
        cat.enabled = sw.checked;
        saveSettings(currentMemory);
      }
    });
  });
}

function showCategoryForm(existingCat = null) {
  const isNew = !existingCat;
  const cat = existingCat || { id: '', name: '', prompt: '', enabled: true, builtin: false, type: 'summary' };
  const currentType = cat.type || 'summary';

  const result = showModal({
    title: isNew ? '新增总结分类' : '编辑总结分类',
    content: `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <mdui-text-field variant="outlined" id="cat-name" label="分类名称" value="${escapeHtml(cat.name)}"></mdui-text-field>
        <div>
          <div style="font-size: 12px; color: var(--mdui-color-on-surface-variant); margin-bottom: 8px;">分类类型</div>
          <mdui-segmented-button-group selects="single" id="cat-type" value="${currentType}" style="width: 100%;">
            <mdui-segmented-button value="summary">分段总结</mdui-segmented-button>
            <mdui-segmented-button value="todo">TODO列表</mdui-segmented-button>
            <mdui-segmented-button value="tracking">状态追踪</mdui-segmented-button>
          </mdui-segmented-button-group>
          <div style="font-size: 11px; color: var(--mdui-color-on-surface-variant); margin-top: 4px;">
            分段总结：每N层生成独立总结 | TODO列表：持续更新事件完成状态 | 状态追踪：持续更新人物/事物状态
          </div>
        </div>
        <mdui-text-field variant="outlined" id="cat-prompt" label="总结提示词" rows="6" max-rows="15"
          placeholder="输入让 LLM 生成此分类总结的提示词..."
          value="${escapeHtml(cat.prompt)}"></mdui-text-field>
      </div>
    `,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isNew ? '添加' : '保存', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      // 克隆按钮移除 Modal 默认绑定的 click 监听，确保验证逻辑优先生效
      const saveBtn = dialog.querySelector('[data-action="save"]');
      const cloned = saveBtn.cloneNode(true);
      saveBtn.parentNode.replaceChild(cloned, saveBtn);
      cloned.addEventListener('click', () => {
        const name = dialog.querySelector('#cat-name').value.trim();
        const prompt = dialog.querySelector('#cat-prompt').value.trim();
        const type = dialog.querySelector('#cat-type').value || 'summary';
        if (!name) { showError('分类名称不能为空'); return; }
        if (!prompt) { showError('提示词不能为空'); return; }

        if (isNew) {
          const newId = 'cat_' + Date.now().toString(36);
          currentMemory.categories.push({ id: newId, name, prompt, enabled: true, builtin: false, type });
        } else {
          const idx = currentMemory.categories.findIndex((c) => c.id === cat.id);
          if (idx >= 0) {
            currentMemory.categories[idx] = { ...currentMemory.categories[idx], name, prompt, type };
          }
        }
        saveSettings(currentMemory);
        close('save');
      });
    },
  });

  result.then((val) => {
    if (val === 'save') {
      const container = document.getElementById('cp-content-memory');
      if (container) renderCategories(container);
      showSuccess(isNew ? '分类已添加' : '分类已保存');
    }
  });
}

// ============ 总结卡片区 ============

function renderSummaryCards(container) {
  const listEl = container.querySelector('#cp-memory-summaries');
  if (!listEl) return;

  if (currentSummaries.length === 0) {
    listEl.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty__title">暂无总结</div>
        <div class="cp-empty__desc">对话达到指定层数后将自动生成总结，也可点击"立即总结"手动生成</div>
      </div>`;
    return;
  }

  // 按更新时间倒序排列（最新的在前）
  const sorted = [...currentSummaries].sort(
    (a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
  );

  listEl.innerHTML = `<div class="cp-memory-grid">${sorted
    .map((s) => {
      const cat = currentMemory.categories.find((c) => c.id === s.categoryId);
      const catName = cat?.name || s.categoryId;
      const catType = cat?.type || 'summary';
      const typeLabel = catType === 'todo' ? 'TODO' : catType === 'tracking' ? '追踪' : '';
      const timeLabel = s.updatedAt ? formatRelativeTime(s.updatedAt) : formatRelativeTime(s.createdAt);
      return `
      <mdui-card class="cp-memory-card" variant="filled" clickable>
        <div class="cp-memory-card__header">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="cp-badge">${escapeHtml(catName)}</span>
            ${typeLabel ? `<span class="cp-badge cp-badge--info">${typeLabel}</span>` : ''}
          </div>
          <span class="cp-memory-card__range">第 ${s.floorRange[0]}-${s.floorRange[1]} 层</span>
        </div>
        <div class="cp-memory-card__content">${escapeHtml(s.content)}</div>
        <div class="cp-memory-card__footer">
          <span class="cp-memory-card__time">
            ${timeLabel}${s.isEdited ? ' · 已编辑' : ''}
          </span>
          <div class="cp-memory-card__actions">
            <mdui-button-icon icon="edit" data-action="edit-summary" data-id="${escapeHtml(s.id)}" label="编辑"></mdui-button-icon>
            <mdui-button-icon icon="delete" data-action="delete-summary" data-id="${escapeHtml(s.id)}" label="删除"
              style="color: var(--mdui-color-error);"></mdui-button-icon>
          </div>
        </div>
      </mdui-card>
    `;
    })
    .join('')}</div>`;

  // 绑定编辑/删除事件
  listEl.querySelectorAll('[data-action="edit-summary"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const summary = currentSummaries.find((s) => s.id === btn.dataset.id);
      if (summary) showSummaryEditForm(summary);
    });
  });

  listEl.querySelectorAll('[data-action="delete-summary"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirm('确定删除这条总结吗？', '删除总结');
      if (!ok) return;
      try {
        const convId = getConvId();
        await conversationApi.deleteSummary(convId, btn.dataset.id);
        currentSummaries = currentSummaries.filter((s) => s.id !== btn.dataset.id);
        renderSummaryCards(container);
        showSuccess('总结已删除');
      } catch (err) {
        showError(err.message || '删除失败');
      }
    });
  });
}

function showSummaryEditForm(summary) {
  const result = showModal({
    title: '编辑总结',
    content: `
      <mdui-text-field variant="outlined" id="summary-content" label="总结内容" rows="8" max-rows="20"
        value="${escapeHtml(summary.content)}"></mdui-text-field>
    `,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '保存', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      const saveBtn = dialog.querySelector('[data-action="save"]');
      const cloned = saveBtn.cloneNode(true);
      saveBtn.parentNode.replaceChild(cloned, saveBtn);
      cloned.addEventListener('click', async () => {
        const content = dialog.querySelector('#summary-content').value.trim();
        if (!content) { showError('内容不能为空'); return; }
        try {
          const convId = getConvId();
          await conversationApi.updateSummary(convId, summary.id, content);
          const idx = currentSummaries.findIndex((s) => s.id === summary.id);
          if (idx >= 0) {
            currentSummaries[idx] = { ...currentSummaries[idx], content, isEdited: true };
          }
          close('save');
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });

  result.then((val) => {
    if (val === 'save') {
      const container = document.getElementById('cp-content-memory');
      if (container) renderSummaryCards(container);
      showSuccess('总结已保存');
    }
  });
}

// ============ 手动生成总结 ============

async function handleGenerate(container) {
  if (isGenerating) return;
  isGenerating = true;

  const genBtn = container.querySelector('#cp-memory-generate');
  if (genBtn) {
    genBtn.disabled = true;
    genBtn.loading = true;
  }

  try {
    const convId = getConvId();
    const prevCount = currentSummaries.length;
    const res = await conversationApi.generateSummary(convId);
    currentSummaries = res?.summaries || [];
    renderSummaryCards(container);

    if (currentSummaries.length > prevCount) {
      showSuccess(`总结已更新（共 ${currentSummaries.length} 条）`);
    } else if (currentSummaries.length === prevCount && currentSummaries.length > 0) {
      showSuccess('总结已更新');
    } else {
      showInfo('暂无新的对话内容需要总结');
    }
  } catch (err) {
    showError(err.message || '生成总结失败');
  } finally {
    isGenerating = false;
    if (genBtn) {
      genBtn.disabled = false;
      genBtn.loading = false;
    }
  }
}

// ============ 保存总结列表到后端 ============

async function saveSummaries() {
  const convId = getConvId();
  if (!convId) return;
  try {
    const conv = appState.get('currentConversation');
    if (conv) {
      const updatedSettings = { ...conv.settings, memory: currentMemory, memorySummaries: currentSummaries };
      await conversationApi.update(convId, { settings: updatedSettings });
      conv.settings = updatedSettings;
      appState.set('currentConversation', conv);
    }
  } catch (err) {
    showError(err.message || '保存总结失败');
  }
}
