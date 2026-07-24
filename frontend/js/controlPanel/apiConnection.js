/**
 * 模块 2: API 连接
 * 管理 LLM 配置（连接到 AI 模型）
 */
import appState from '../stores/appState.js';
import { llmConfigApi } from '../api/index.js';
import { showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml } from '../utils/helpers.js';

let allConfigs = [];

/**
 * 渲染 API 连接模块
 */
export async function renderApiConnection(container, opts = {}) {
  container.innerHTML = `
    <div class="cp-toolbar">
      <span class="cp-toolbar__title">API 连接管理</span>
      <mdui-button variant="filled" id="cp-add-llm" icon="add">添加配置</mdui-button>
      <mdui-button-icon icon="refresh" id="cp-refresh-llm" label="刷新"></mdui-button-icon>
    </div>
    <div id="cp-llm-list">
      <div class="cp-empty">
        <mdui-circular-progress style="margin: 0 auto;"></mdui-circular-progress>
      </div>
    </div>
  `;

  container.querySelector('#cp-add-llm')?.addEventListener('click', () => showLlmForm());
  container.querySelector('#cp-refresh-llm')?.addEventListener('click', () => loadList(container));

  await loadList(container);
}

async function loadList(container) {
  const listEl = container.querySelector('#cp-llm-list');
  try {
    allConfigs = await llmConfigApi.list();
    appState.set('llmConfigs', allConfigs);
    renderList(listEl, allConfigs);
  } catch (err) {
    showError(err.message || '加载 LLM 配置失败');
    listEl.innerHTML = `<div class="cp-empty"><div class="cp-empty__title">加载失败</div><div class="cp-empty__desc">${escapeHtml(err.message || '')}</div></div>`;
  }
}

function renderList(listEl, configs) {
  if (!configs || configs.length === 0) {
    listEl.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty__title">还没有 API 配置</div>
        <div class="cp-empty__desc">点击上方"添加配置"以连接 AI 模型</div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = configs.map((c) => `
    <div class="cp-card" data-id="${c.id}">
      <div class="cp-card__main">
        <div class="cp-card__title">
          ${escapeHtml(c.name)}
          ${c.isDefault ? '<span class="cp-badge cp-badge--success"><span class="cp-badge__dot"></span>默认</span>' : ''}
        </div>
        <div class="cp-card__meta">
          <span class="cp-badge">${escapeHtml(c.provider)}</span>
          ${escapeHtml(c.model || '未指定模型')}
          ${c.baseUrl ? ` · ${escapeHtml(c.baseUrl)}` : ''}
        </div>
      </div>
      <div class="cp-card__actions">
        <mdui-button-icon icon="check_circle" data-action="test" label="测试连接"></mdui-button-icon>
        <mdui-button-icon icon="edit" data-action="edit" label="编辑"></mdui-button-icon>
        <mdui-button-icon icon="delete" data-action="delete" label="删除" style="color: var(--md-sys-color-error);"></mdui-button-icon>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.cp-card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action, id, listEl));
    });
  });
}

async function handleAction(action, id, listEl) {
  const config = allConfigs.find((c) => c.id === id);
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
        await loadList(listEl.closest('.control-panel__content'));
      } catch (err) {
        showError(err.message || '删除失败');
      }
      break;
  }
}

async function showLlmForm(config = null) {
  const isEdit = !!config;
  const c = config || {};

  const content = `
    <div class="mgmt-form">
      <div class="form-group">
        <mdui-text-field id="llm-name" label="配置名称 *" variant="outlined" value="${escapeHtml(c.name || '')}" placeholder="如：我的 GPT-4" required></mdui-text-field>
      </div>

      <div class="mgmt-form__row">
        <div class="form-group">
          <mdui-select id="llm-provider" label="提供商 *" variant="outlined" value="${c.provider || 'openai'}">
            <mdui-menu-item value="openai">OpenAI</mdui-menu-item>
            <mdui-menu-item value="anthropic">Anthropic</mdui-menu-item>
            <mdui-menu-item value="custom">自定义</mdui-menu-item>
          </mdui-select>
        </div>
        <div class="form-group">
          <mdui-text-field id="llm-model" label="模型 *" variant="outlined" value="${escapeHtml(c.model || '')}" placeholder="如：gpt-4o, claude-3-opus" required></mdui-text-field>
        </div>
      </div>

      <div class="form-group">
        <mdui-text-field id="llm-api-key" label="API Key ${isEdit ? '（留空则不修改）' : '*'}" variant="outlined" type="password" placeholder="${isEdit ? escapeHtml(c.apiKey || '***') : 'sk-...'}" ${isEdit ? '' : 'required'}></mdui-text-field>
      </div>

      <div class="form-group">
        <mdui-text-field id="llm-base-url" label="Base URL（可选）" variant="outlined" value="${escapeHtml(c.baseUrl || '')}" placeholder="https://api.openai.com/v1"></mdui-text-field>
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
      dialog.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const name = dialog.querySelector('#llm-name').value.trim();
        const provider = dialog.querySelector('#llm-provider').value;
        const model = dialog.querySelector('#llm-model').value.trim();
        const apiKey = dialog.querySelector('#llm-api-key').value;
        const baseUrl = dialog.querySelector('#llm-base-url').value.trim() || undefined;
        const isDefault = dialog.querySelector('#llm-default').checked;

        if (!name || !provider || !model) {
          showError('名称、提供商、模型不能为空');
          return;
        }
        if (!isEdit && !apiKey) {
          showError('API Key 不能为空');
          return;
        }

        const extraParams = c.extraParams || {};
        const data = { name, provider, model, baseUrl, isDefault, extraParams };
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
          // 刷新列表
          const container = document.getElementById('cp-content-api-connection');
          if (container) await loadList(container);
        } catch (err) {
          showError(err.message || '保存失败');
        }
      });
    },
  });
}

export default { renderApiConnection };
