/**
 * 模块 1: 回应配置 + 提示词管理器
 * 控制 Chat Completion API 的采样参数和提示词构建
 */
import appState from '../stores/appState.js';
import { llmConfigApi, conversationApi } from '../api/index.js';
import { showSuccess, showError, showInfo } from '../components/Toast.js';
import { showModal, confirm } from '../components/Modal.js';
import { getIcon } from '../components/Icon.js';
import { escapeHtml } from '../utils/helpers.js';
import storage from '../utils/storage.js';
import * as userSettingsModule from './userSettings.js';

const PRESETS_KEY = 'cp_response_presets';
const PROMPTS_KEY = 'cp_response_prompts';
const PROMPT_ORDER_KEY = 'cp_response_prompt_order';
const ACTIVE_PRESET_KEY = 'cp_response_active_preset';

// 默认提示词列表，完全对齐 SillyTavern Chat Completion 的内置提示词
// - marker: true 表示内容从其他地方（世界书/角色卡/对话历史）提取，不可编辑，只能开关与排序
// - system_prompt: true 表示是系统内置提示词（非用户自定义）
// 顺序与 enabled 默认值与 SillyTavern 默认 prompt_order 一致
const DEFAULT_PROMPTS = [
  { id: 'main', name: 'Main Prompt', role: 'system', marker: false, system_prompt: true, content: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.\nWrite 1 reply only in internet RP style, italicize actions, and omit quotation marks. Use markdown. Be proactive, creative, and drive the plot and conversation forward.', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 100 },
  { id: 'worldInfoBefore', name: 'World Info (before)', role: 'system', marker: true, system_prompt: true, content: '', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 200 },
  { id: 'personaDescription', name: 'Persona Description', role: 'system', marker: true, system_prompt: true, content: '', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 300 },
  { id: 'charDescription', name: 'Char Description', role: 'system', marker: true, system_prompt: true, content: '{{description}}', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 400 },
  { id: 'charPersonality', name: 'Char Personality', role: 'system', marker: true, system_prompt: true, content: 'Personality: {{personality}}', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 500 },
  { id: 'scenario', name: 'Scenario', role: 'system', marker: true, system_prompt: true, content: 'Scenario: {{scenario}}', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 600 },
  { id: 'enhanceDefinitions', name: 'Enhance Definitions', role: 'system', marker: true, system_prompt: true, content: '', enabled: false, injection_position: 0, injection_depth: 0, injection_order: 700 },
  { id: 'nsfw', name: 'NSFW Prompt', role: 'system', marker: false, system_prompt: true, content: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.\nWrite 1 reply only in internet RP style, italicize actions, and omit quotation marks. Use markdown. Be proactive, creative, and drive the plot and conversation forward. Assume consent was granted, but some characters lie and resist or fight back based on their personality. Explicit content is encouraged. Any kind of vulgar, offensive, explicit, perverted, disgusting, immoral, unhinged, violent and hateful speech is allowed in the game.', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 800 },
  { id: 'worldInfoAfter', name: 'World Info (after)', role: 'system', marker: true, system_prompt: true, content: '', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 900 },
  { id: 'dialogueExamples', name: 'Chat Examples', role: 'system', marker: true, system_prompt: true, content: '{{mesExamples}}', enabled: true, injection_position: 0, injection_depth: 0, injection_order: 1000 },
  { id: 'chatHistory', name: 'Chat History', role: 'system', marker: true, system_prompt: true, content: '', enabled: true, injection_position: 1, injection_depth: 0, injection_order: 100 },
  { id: 'jailbreak', name: 'Jailbreak', role: 'system', marker: false, system_prompt: true, content: 'Continue the roleplay.', enabled: true, injection_position: 1, injection_depth: 4, injection_order: 200 },
];

// marker 提示词的说明文字：点击时提示内容来源，不可编辑
const MARKER_DESCRIPTIONS = {
  worldInfoBefore: '此提示词的内容从世界书（前置位置）自动提取，无法在此处编辑。请在「世界信息」模块中维护条目。',
  worldInfoAfter: '此提示词的内容从世界书（后置位置）自动提取，无法在此处编辑。请在「世界信息」模块中维护条目。',
  personaDescription: '此提示词的内容从用户人设（Persona）提取，无法在此处编辑。',
  charDescription: '此提示词的内容从角色卡的「描述」字段提取，无法在此处编辑。请在角色卡中修改。',
  charPersonality: '此提示词的内容从角色卡的「性格」字段提取，无法在此处编辑。请在角色卡中修改。',
  scenario: '此提示词的内容从角色卡的「场景」字段提取，无法在此处编辑。请在角色卡中修改。',
  enhanceDefinitions: '此提示词的内容从角色卡的扩展定义提取，无法在此处编辑。',
  dialogueExamples: '此提示词的内容从角色卡的「对话示例」提取，无法在此处编辑。请在角色卡中修改。',
};

const DEFAULT_PRESET = {
  name: 'Default',
  settings: {
    temperature: 1.0,
    topP: 1.0,
    topK: 0,
    minP: 0,
    maxContextTokens: 4096,
    maxResponseTokens: 300,
    repetitionPenalty: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stream: true,
    reasoningEffort: 'high',
    thinkingBudget: 2000,
    enableThinking: true,
  },
  // 每个预设内嵌自己的提示词列表（与 SillyTavern 模型一致，预设间互不干扰）
  prompts: DEFAULT_PROMPTS.map((p) => ({ ...p })),
};

// ============ 存储 ============
// 预设结构：{ name, settings, prompts } —— 每个预设内嵌自己的提示词列表，预设间互不干扰
function loadPresets() {
  const raw = storage.get(PRESETS_KEY, null);
  // 迁移源：旧的独立全局 prompts 存储（cp_response_prompts），用于填充无 prompts 字段的旧预设
  const legacyPrompts = storage.get(PROMPTS_KEY, null);
  const fallbackPrompts = Array.isArray(legacyPrompts) && legacyPrompts.length > 0
    ? legacyPrompts
    : DEFAULT_PROMPTS.map((p) => ({ ...p }));

  if (!Array.isArray(raw) || raw.length === 0) {
    return [{
      name: 'Default',
      settings: { ...DEFAULT_PRESET.settings },
      prompts: JSON.parse(JSON.stringify(fallbackPrompts)),
    }];
  }
  // 确保每个预设都有 prompts（旧结构无此字段时用迁移源/默认填充），并深拷贝避免共享引用
  return raw.map((p) => ({
    name: p.name,
    settings: p.settings || { ...DEFAULT_PRESET.settings },
    prompts: Array.isArray(p.prompts) && p.prompts.length > 0
      ? p.prompts
      : JSON.parse(JSON.stringify(fallbackPrompts)),
    regexScripts: Array.isArray(p.regexScripts) ? p.regexScripts : undefined,
  }));
}
function savePresets(presets) {
  storage.set(PRESETS_KEY, presets);
}
// 旧 id → 新 id 映射（兼容历史数据：SillyTavern 对齐前的命名）
const PROMPT_ID_MIGRATION = { charScenario: 'scenario', examples: 'dialogueExamples' };
/**
 * 迁移历史 prompts 数据：
 * - 重命名旧 id（charScenario→scenario, examples→dialogueExamples）
 * - 内置提示词补全 marker/system_prompt 字段（保留用户对 content 的修改）
 * - 自定义提示词补全 marker/system_prompt 字段
 */
function migratePrompts(list) {
  if (!Array.isArray(list)) return DEFAULT_PROMPTS.map((p) => ({ ...p }));
  return list.map((p) => {
    const id = PROMPT_ID_MIGRATION[p.id] || p.id;
    const builtin = DEFAULT_PROMPTS.find((d) => d.id === id);
    if (builtin) {
      return { ...builtin, ...p, id, marker: builtin.marker, system_prompt: builtin.system_prompt };
    }
    return { marker: false, system_prompt: false, ...p, id };
  });
}

// 读取当前激活预设的提示词列表（不再从全局独立存储读取）
function loadPrompts() {
  const presets = loadPresets();
  const name = loadActivePreset();
  const preset = presets.find((p) => p.name === name) || presets[0];
  return migratePrompts(preset?.prompts || DEFAULT_PROMPTS.map((p) => ({ ...p })));
}
// 保存提示词列表到当前激活预设（不再写全局独立存储）
function savePrompts(prompts) {
  const presets = loadPresets();
  const name = loadActivePreset();
  const idx = presets.findIndex((p) => p.name === name);
  if (idx >= 0) {
    presets[idx].prompts = prompts;
  } else if (presets.length > 0) {
    presets[0].prompts = prompts;
  }
  savePresets(presets);
}
function loadActivePreset() {
  return storage.get(ACTIVE_PRESET_KEY, 'Default');
}
function saveActivePreset(name) {
  storage.set(ACTIVE_PRESET_KEY, name);
}

// 导出当前 Prompt Manager 的提示词列表，供新建对话时自动注入
export function getCurrentPrompts() {
  return loadPrompts();
}

// ============ SillyTavern 预设导入/导出 ============

// 内置提示词 id 集合（对应 SillyTavern 的 system_prompt 字段）
const BUILTIN_PROMPT_IDS = new Set(DEFAULT_PROMPTS.map((p) => p.id));
// marker 提示词 id 集合（内容从其他地方提取，不可编辑）：基于 DEFAULT_PROMPTS 的 marker 字段动态生成
const MARKER_PROMPT_IDS = new Set(DEFAULT_PROMPTS.filter((p) => p.marker).map((p) => p.id));

/**
 * 内部 settings + prompts → SillyTavern Chat Completion 预设格式
 * SillyTavern 预设文件内嵌 prompts 数组与 prompt_order，导出时一并带上
 */
function presetToSillyTavern(settings, name, prompts, regexScripts) {
  const { prompts: stPrompts, prompt_order } = promptsToSillyTavern(prompts);
  const result = {
    chat_completion_source: 'openai',
    preset: name,
    temperature: settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
    min_p: settings.minP,
    repetition_penalty: settings.repetitionPenalty,
    frequency_penalty: settings.frequencyPenalty,
    presence_penalty: settings.presencePenalty,
    openai_max_context: settings.maxContextTokens,
    openai_max_tokens: settings.maxResponseTokens,
    stream_openai: settings.stream,
    reasoning_effort: settings.reasoningEffort,
    // 非标准扩展字段（SillyTavern 会忽略不认识的字段）
    thinking_budget: settings.thinkingBudget,
    enable_thinking: settings.enableThinking,
    prompts: stPrompts,
    prompt_order,
  };
  // 附带正则脚本（SillyTavern 格式）
  if (Array.isArray(regexScripts) && regexScripts.length > 0) {
    result.regex_scripts = regexScriptsToSillyTavern(regexScripts);
  }
  return result;
}

/**
 * 内部 RegexScript[] → SillyTavern regex_scripts 格式
 * 用于预设导出 / 写回角色卡 extensions.regex_scripts（sillyTavernToRegexScripts 的逆向转换）
 */
export function regexScriptsToSillyTavern(scripts) {
  return scripts.map((s) => ({
    scriptName: s.name,
    findRegex: s.findRegex,
    replaceString: s.replaceWith,
    trimStrings: s.trimOut ? s.trimOut.split('\n').filter(Boolean) : [],
    minimumDepth: s.minDepth ?? -1,
    maximumDepth: s.maxDepth ?? -1,
    disabled: !s.enabled,
    markdownOnly: !!s.affects.display && !s.affects.prompt,
    promptOnly: s.affects.prompt && !s.affects.display,
    runOnEdit: s.affects.userInput,
    substituteRegex: true,
  }));
}

/**
 * SillyTavern 预设文件中的 regex_scripts → 内部 RegexScript[]
 * 兼容多种字段位置：顶层 regex_scripts / extensions.regex_scripts / data.extensions.regex_scripts
 */
export function sillyTavernToRegexScripts(data) {
  const raw = data.regex_scripts
    ?? data.extensions?.regex_scripts
    ?? data.data?.extensions?.regex_scripts
    ?? null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((s, idx) => {
    const promptOnly = !!s.promptOnly;
    const runOnEdit = !!s.runOnEdit;
    return {
      id: `regex_import_${Date.now()}_${idx}`,
      name: s.scriptName || s.name || `导入正则 ${idx + 1}`,
      findRegex: s.findRegex || '',
      replaceWith: s.replaceString ?? s.replaceWith ?? '',
      trimOut: Array.isArray(s.trimStrings) && s.trimStrings.length > 0
        ? s.trimStrings.join('\n')
        : (typeof s.trimOut === 'string' ? s.trimOut : undefined),
      enabled: s.disabled != null ? !s.disabled : (s.enabled != null ? !!s.enabled : true),
      affects: {
        display: !promptOnly,
        userInput: runOnEdit,
        prompt: promptOnly || !s.markdownOnly,
      },
      scope: 'global',
      minDepth: (s.minimumDepth != null && s.minimumDepth !== -1) ? s.minimumDepth
        : (s.minDepth != null && s.minDepth !== -1) ? s.minDepth : undefined,
      maxDepth: (s.maximumDepth != null && s.maximumDepth !== -1) ? s.maximumDepth
        : (s.maxDepth != null && s.maxDepth !== -1) ? s.maxDepth : undefined,
      order: idx,
    };
  });
}

/**
 * 内部 prompts → SillyTavern prompts 数组 + prompt_order
 * 内部字段 content 对应 SillyTavern 的 prompt；id 对应 identifier
 */
function promptsToSillyTavern(prompts) {
  const list = Array.isArray(prompts) ? prompts : [];
  const stPrompts = list.map((p) => ({
    name: p.name,
    system_prompt: p.system_prompt ?? BUILTIN_PROMPT_IDS.has(p.id),
    marker: p.marker ?? MARKER_PROMPT_IDS.has(p.id),
    prompt: p.content,
    identifier: p.id,
    role: p.role,
    injection_position: p.injection_position ?? 0,
    injection_depth: p.injection_depth ?? 0,
    injection_order: p.injection_order ?? 100,
    enabled: !!p.enabled,
  }));
  const prompt_order = [
    {
      character_id: 100001, // SillyTavern 用 100001 表示全局默认顺序
      order: list.map((p) => ({ identifier: p.id, enabled: !!p.enabled })),
    },
  ];
  return { prompts: stPrompts, prompt_order };
}

/**
 * SillyTavern prompts + prompt_order → 内部 prompts
 * SillyTavern 导出的 prompts 数组常为空（内置提示词内容不导出），此时用 DEFAULT_PROMPTS
 * 作为内置提示词的内容来源，按 prompt_order 决定顺序与 enabled。
 * 用户对可编辑内置提示词（main/nsfw/jailbreak）的修改若出现在 data.prompts 中则保留。
 */
function sillyTavernToPrompts(data) {
  const stPrompts = Array.isArray(data.prompts) ? data.prompts : [];
  const builtinById = new Map(DEFAULT_PROMPTS.map((p) => [p.id, p]));

  // enabled 值解析：兼容 boolean / 0|1 / "true"|"false" / disable 反义字段
  function resolveBoolEnabled(val, defaultVal) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val === 'true' || val === '1';
    return defaultVal;
  }

  // prompts 数组按 identifier 索引（用于读取 enabled / content 等信息）
  const stPromptById = new Map();
  stPrompts.forEach((p) => {
    if (p.identifier) stPromptById.set(p.identifier, p);
  });

  // 内置提示词的内容覆盖：data.prompts 中若含内置 identifier 且 content 非空，保留用户修改
  const builtinOverride = new Map();
  // 自定义提示词（非内置 identifier）
  const customPrompts = [];
  stPrompts.forEach((p, idx) => {
    const content = p.prompt ?? p.content ?? '';
    if (builtinById.has(p.identifier)) {
      if (content) builtinOverride.set(p.identifier, content);
    } else {
      customPrompts.push({
        id: p.identifier || `prompt_${Date.now()}_${idx}`,
        name: p.name || `提示词 ${idx + 1}`,
        role: p.role || 'system',
        marker: false,
        system_prompt: false,
        content,
        enabled: resolveBoolEnabled(p.enabled, true),
        injection_position: p.injection_position ?? 0,
        injection_depth: p.injection_depth ?? 0,
        injection_order: p.injection_order ?? 100,
      });
    }
  });
  const customById = new Map(customPrompts.map((p) => [p.id, p]));

  // 解析 orderList，兼容多种格式：
  //  1. 标准格式：prompt_order: [{ character_id, order: [{identifier, enabled}] }]
  //     可能有多个 character_id，优先取 100001（全局默认）
  //  2. 扁平格式：prompt_order: [{ identifier, enabled }]（直接是 order 列表）
  //  3. 对象格式：prompt_order: { "100001": [{identifier, enabled}] }（以 character_id 为 key）
  let orderList = [];
  const po = data.prompt_order;
  if (Array.isArray(po) && po.length > 0) {
    // 标准/扁平数组格式
    // 优先寻找 character_id === 100001 的元素
    const globalEntry = po.find((e) => e && e.character_id === 100001 && Array.isArray(e.order));
    if (globalEntry) {
      orderList = globalEntry.order;
    } else if (Array.isArray(po[0].order)) {
      // 取第一个有 order 数组的元素
      orderList = po[0].order;
    } else {
      // 扁平格式：po 本身就是 order 列表
      orderList = po;
    }
  } else if (po && typeof po === 'object' && !Array.isArray(po)) {
    // 对象格式：以 character_id 为 key
    const keys = Object.keys(po);
    // 优先取 "100001"
    const globalKey = keys.find((k) => k === '100001') || keys[0];
    if (globalKey) {
      const entry = po[globalKey];
      orderList = Array.isArray(entry) ? entry : (entry?.order && Array.isArray(entry.order) ? entry.order : []);
    }
  }

  // enabled 读取（多级兜底）：order 元素 > prompts 元素 > 内置默认 > true
  // 兼容 enabled / disable 反义字段
  const resolveEnabled = (orderEntry, identifier) => {
    if (orderEntry) {
      if ('enabled' in orderEntry) return resolveBoolEnabled(orderEntry.enabled, true);
      // 某些格式用 disable（反义）
      if ('disable' in orderEntry) return !resolveBoolEnabled(orderEntry.disable, false);
    }
    const stPrompt = stPromptById.get(identifier);
    if (stPrompt) {
      if ('enabled' in stPrompt) return resolveBoolEnabled(stPrompt.enabled, true);
      if ('disable' in stPrompt) return !resolveBoolEnabled(stPrompt.disable, false);
    }
    const builtin = builtinById.get(identifier);
    if (builtin) return builtin.enabled;
    return true;
  };

  if (orderList.length > 0) {
    const result = [];
    const seen = new Set();
    let nextOrder = 100;
    for (const o of orderList) {
      const identifier = o.identifier;
      if (!identifier) continue;
      const enabled = resolveEnabled(o, identifier);
      let item = null;
      if (builtinById.has(identifier)) {
        const builtin = builtinById.get(identifier);
        item = {
          ...builtin,
          enabled,
          injection_order: nextOrder,
          ...(builtinOverride.has(identifier) ? { content: builtinOverride.get(identifier) } : {}),
        };
      } else if (customById.has(identifier)) {
        item = { ...customById.get(identifier), enabled, injection_order: nextOrder };
      }
      if (item) {
        result.push(item);
        seen.add(identifier);
        nextOrder += 100;
      }
    }
    // 追加未在 order 中出现的自定义提示词
    for (const c of customPrompts) {
      if (!seen.has(c.id)) result.push(c);
    }
    return result;
  }

  // 无 orderList：返回默认内置 + 自定义（data.prompts 为空时即 DEFAULT_PROMPTS）
  return [...DEFAULT_PROMPTS.map((p) => ({ ...p })), ...customPrompts];
}

/**
 * SillyTavern Chat Completion 预设格式 → 内部 settings
 * 对缺失字段用默认值兜底
 */
function sillyTavernToSettings(data) {
  const s = DEFAULT_PRESET.settings;
  return {
    temperature: data.temperature ?? data.temp ?? s.temperature,
    topP: data.top_p ?? s.topP,
    topK: data.top_k ?? s.topK,
    minP: data.min_p ?? s.minP,
    repetitionPenalty: data.repetition_penalty ?? data.rep_pen ?? s.repetitionPenalty,
    frequencyPenalty: data.frequency_penalty ?? data.freq_pen ?? s.frequencyPenalty,
    presencePenalty: data.presence_penalty ?? data.presence_pen ?? s.presencePenalty,
    maxContextTokens: data.openai_max_context ?? s.maxContextTokens,
    maxResponseTokens: data.openai_max_tokens ?? s.maxResponseTokens,
    stream: data.stream_openai ?? s.stream,
    reasoningEffort: data.reasoning_effort ?? s.reasoningEffort,
    thinkingBudget: data.thinking_budget ?? s.thinkingBudget,
    enableThinking: data.enable_thinking ?? s.enableThinking,
  };
}

/** 触发 JSON 文件下载 */
function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 根据当前激活预设加载/卸载预设正则脚本
 * 切换预设时调用，将预设自带的正则设置到 appState，不使用该预设时自动卸载
 */
export function applyActivePresetRegex() {
  const presets = loadPresets();
  const name = loadActivePreset();
  const preset = presets.find((p) => p.name === name);
  const presetRegex = preset?.regexScripts || [];
  appState.set('presetRegexScripts', presetRegex);
  // 通知正则面板刷新
  document.dispatchEvent(new CustomEvent('regex-scripts-updated'));
}

/**
 * 渲染回应配置模块
 */
export function renderResponseConfig(container, opts = {}) {
  const presets = loadPresets();
  const activePresetName = loadActivePreset();
  const activePreset = presets.find((p) => p.name === activePresetName) || presets[0] || DEFAULT_PRESET;
  const settings = activePreset.settings || DEFAULT_PRESET.settings;
  const prompts = loadPrompts();

  container.innerHTML = `
    <div class="cp-preset-bar">
      <mdui-select id="cp-preset-select" variant="outlined" class="cp-preset-bar__select" value="${escapeHtml(activePresetName)}">
        ${presets.map((p) => `<mdui-menu-item value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</mdui-menu-item>`).join('')}
      </mdui-select>
      <mdui-button variant="outlined" id="cp-preset-save" icon="save">保存预设</mdui-button>
      <mdui-button variant="outlined" id="cp-preset-new">新建预设</mdui-button>
      <mdui-button-icon icon="file_download" label="导出预设（SillyTavern 格式）" id="cp-preset-export"></mdui-button-icon>
      <mdui-button-icon icon="file_upload" label="导入预设（SillyTavern 格式）" id="cp-preset-import"></mdui-button-icon>
      <input type="file" id="cp-preset-import-input" accept=".json,application/json" style="display:none">
      <mdui-button-icon icon="delete" label="删除预设" id="cp-preset-delete" style="color: var(--md-sys-color-error);"></mdui-button-icon>
    </div>

    <div class="cp-section">
      <mdui-collapse class="cp-collapse" data-collapsed="true">
        <mdui-collapse-item value="sampling">
          <div slot="header" class="cp-section__title cp-collapse__header">
            <span class="cp-section__title-icon">${getIcon('sliders', 18)}</span>
            采样参数
            <mdui-icon name="expand_more" class="cp-collapse__arrow"></mdui-icon>
            <mdui-ripple class="cp-collapse__ripple"></mdui-ripple>
          </div>
          <div class="cp-collapse__body">
      <div class="cp-grid">
        <div class="cp-field">
          <label class="cp-field__label">
            Temperature
            <span class="cp-field__hint" data-hint="temperature">${settings.temperature}</span>
          </label>
          <div class="cp-slider">
            <mdui-slider data-setting="temperature" data-scale="0.01" min="0" max="200" step="5" value="${Math.round(settings.temperature * 100)}"></mdui-slider>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">
            Top P
            <span class="cp-field__hint" data-hint="topP">${settings.topP}</span>
          </label>
          <div class="cp-slider">
            <mdui-slider data-setting="topP" data-scale="0.01" min="0" max="100" step="1" value="${Math.round(settings.topP * 100)}"></mdui-slider>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">
            Top K
            <span class="cp-field__hint" data-hint="topK">${settings.topK}</span>
          </label>
          <div class="cp-slider">
            <mdui-slider data-setting="topK" min="0" max="100" step="1" value="${settings.topK}"></mdui-slider>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">
            Min P
            <span class="cp-field__hint" data-hint="minP">${settings.minP}</span>
          </label>
          <div class="cp-slider">
            <mdui-slider data-setting="minP" data-scale="0.01" min="0" max="100" step="1" value="${Math.round(settings.minP * 100)}"></mdui-slider>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">
            Repetition Penalty
            <span class="cp-field__hint" data-hint="repetitionPenalty">${settings.repetitionPenalty}</span>
          </label>
          <div class="cp-slider">
            <mdui-slider data-setting="repetitionPenalty" data-scale="0.01" min="50" max="200" step="5" value="${Math.round(settings.repetitionPenalty * 100)}"></mdui-slider>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">
            Frequency Penalty
            <span class="cp-field__hint" data-hint="frequencyPenalty">${settings.frequencyPenalty}</span>
          </label>
          <div class="cp-slider">
            <mdui-slider data-setting="frequencyPenalty" data-scale="0.1" min="-20" max="20" step="1" value="${Math.round(settings.frequencyPenalty * 10)}"></mdui-slider>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">
            Presence Penalty
            <span class="cp-field__hint" data-hint="presencePenalty">${settings.presencePenalty}</span>
          </label>
          <div class="cp-slider">
            <mdui-slider data-setting="presencePenalty" data-scale="0.1" min="-20" max="20" step="1" value="${Math.round(settings.presencePenalty * 10)}"></mdui-slider>
          </div>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">最大上下文 Tokens</label>
          <mdui-text-field variant="outlined" type="number" data-setting="maxContextTokens" value="${settings.maxContextTokens}" min="512" max="200000" step="512"></mdui-text-field>
        </div>

        <div class="cp-field">
          <label class="cp-field__label">最大响应 Tokens</label>
          <mdui-text-field variant="outlined" type="number" data-setting="maxResponseTokens" value="${settings.maxResponseTokens}" min="1" max="64000"></mdui-text-field>
        </div>
      </div>

      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">流式输出</div>
          <div class="cp-switch-row__desc">实时显示 AI 生成的文字</div>
        </div>
        <mdui-switch data-setting="stream" ${settings.stream ? 'checked' : ''}></mdui-switch>
      </div>
          </div>
        </mdui-collapse-item>
      </mdui-collapse>
    </div>

    <div class="cp-section">
      <mdui-collapse class="cp-collapse" data-collapsed="true">
        <mdui-collapse-item value="reasoning">
          <div slot="header" class="cp-section__title cp-collapse__header">
            <span class="cp-section__title-icon">${getIcon('settings', 18)}</span>
            思维链（Reasoning）设置
            <mdui-icon name="expand_more" class="cp-collapse__arrow"></mdui-icon>
            <mdui-ripple class="cp-collapse__ripple"></mdui-ripple>
          </div>
          <div class="cp-collapse__body">
      <div class="cp-switch-row">
        <div>
          <div class="cp-switch-row__label">显示思维链</div>
          <div class="cp-switch-row__desc">关闭后模型仍会思考，仅隐藏思维链显示（实时生效）</div>
        </div>
        <mdui-switch id="cp-show-thinking" ${userSettingsModule.getSettings().showThinking !== false ? 'checked' : ''}></mdui-switch>
      </div>
      <div class="cp-grid">
        <div class="cp-field">
          <label class="cp-field__label">推理强度（OpenAI o-series）</label>
          <mdui-select data-setting="reasoningEffort" variant="outlined" value="${settings.reasoningEffort || 'medium'}">
            <mdui-menu-item value="low">low</mdui-menu-item>
            <mdui-menu-item value="medium">medium</mdui-menu-item>
            <mdui-menu-item value="high">high</mdui-menu-item>
          </mdui-select>
        </div>
        <div class="cp-field">
          <label class="cp-field__label">思维预算 tokens（Anthropic）</label>
          <mdui-text-field variant="outlined" type="number" data-setting="thinkingBudget" value="${settings.thinkingBudget}" min="1024" max="64000" step="1024"></mdui-text-field>
        </div>
      </div>
          </div>
        </mdui-collapse-item>
      </mdui-collapse>
    </div>

    <div class="cp-section">
      <h3 class="cp-section__title">
        <span class="cp-section__title-icon">${getIcon('format', 18)}</span>
        提示词管理器（Prompt Manager）
        <mdui-button-icon icon="add" label="添加提示词" id="cp-prompt-add" style="margin-left: auto;"></mdui-button-icon>
      </h3>
      <p style="font-size: 12px; color: var(--md-sys-color-on-surface-variant); margin-bottom: var(--md-sys-spacing-2);">
        拖拽排序提示词，点击编辑。支持的宏：<code>{{char}}</code>, <code>{{user}}</code>, <code>{{description}}</code>, <code>{{personality}}</code>, <code>{{scenario}}</code>, <code>{{mesExamples}}</code>
      </p>
      <mdui-list class="cp-prompt-list" id="cp-prompt-list"></mdui-list>
    </div>

    <div class="cp-actions">
      <mdui-button variant="filled" id="cp-apply-settings" icon="check_circle">应用到当前对话</mdui-button>
      <mdui-button variant="outlined" id="cp-save-default">设为默认</mdui-button>
      ${activePresetName === 'Default' ? '<mdui-button variant="outlined" id="cp-reset-default" icon="restart_alt">重置默认</mdui-button>' : ''}
    </div>
  `;

  renderPromptList(container.querySelector('#cp-prompt-list'), prompts);
  bindEvents(container, settings, prompts);
  setupCollapses(container);
}

/**
 * 初始化控制面板内的 mdui-collapse 折叠区块
 * - mdui-collapse 的 value HTML 属性在通过 innerHTML 创建时存在升级时序问题，
 *   统一通过 JS 属性设置初始展开/收起状态（data-collapsed="true" 表示默认折叠）
 * - 同步箭头图标旋转状态
 */
function setupCollapses(scope) {
  scope.querySelectorAll('mdui-collapse[data-collapsed]').forEach((collapse) => {
    const item = collapse.querySelector('mdui-collapse-item');
    const collapsed = collapse.dataset.collapsed === 'true';
    collapse.value = collapsed ? '' : (item?.value || '');

    const arrow = collapse.querySelector('.cp-collapse__arrow');
    if (arrow && item) {
      const update = () => arrow.classList.toggle('cp-collapse__arrow--open', collapse.value === item.value);
      item.addEventListener('open', update);
      item.addEventListener('close', update);
      update();
    }

    // 折叠头水波纹：mdui-ripple 元素需手动接线触发（本构建未内置 ripple 指令）
    const header = collapse.querySelector('[slot="header"]');
    if (header) attachRipple(header);
  });
}

/**
 * 为折叠头部的 mdui-ripple 元素接线指针/焦点事件，触发 mdui 原生水波纹与悬停态
 */
function attachRipple(headerEl) {
  const ripple = headerEl.querySelector('mdui-ripple');
  if (!ripple || headerEl.dataset.rippleBound) return;
  headerEl.dataset.rippleBound = '1';
  headerEl.addEventListener('pointerdown', (e) => ripple.startPress(e));
  headerEl.addEventListener('pointerup', () => ripple.endPress());
  headerEl.addEventListener('pointercancel', () => ripple.endPress());
  headerEl.addEventListener('pointerenter', () => ripple.startHover());
  headerEl.addEventListener('pointerleave', () => {
    ripple.endHover();
    ripple.endPress();
  });
  headerEl.addEventListener('focus', () => ripple.startFocus());
  headerEl.addEventListener('blur', () => ripple.endFocus());
}

function renderPromptList(container, prompts) {
  if (!prompts || prompts.length === 0) {
    container.innerHTML = '<div class="cp-empty"><div class="cp-empty__title">还没有提示词</div><div class="cp-empty__desc">点击上方"添加提示词"</div></div>';
    return;
  }

  container.innerHTML = prompts.map((p, idx) => {
    const isMarker = p.marker || MARKER_PROMPT_IDS.has(p.id);
    const isBuiltin = p.system_prompt || BUILTIN_PROMPT_IDS.has(p.id);
    return `
    <mdui-list-item class="cp-prompt-item ${isMarker ? 'cp-prompt-item--marker' : ''}" data-id="${p.id}" data-index="${idx}" draggable="true">
      <span slot="icon" class="cp-prompt-item__handle">${getIcon('drag', 16)}</span>
      <span class="cp-prompt-item__name">${escapeHtml(p.name)}</span>
      ${isMarker ? '<span class="cp-badge cp-badge--info"><span class="cp-badge__dot"></span>自动提取</span>' : ''}
      ${!p.enabled ? '<span class="cp-badge cp-badge--error">禁用</span>' : ''}
      <span slot="description" class="cp-prompt-item__role cp-prompt-item__role--${p.role}">${p.role}</span>
      <div slot="end-icon" class="cp-prompt-item__actions">
        <mdui-button-icon icon="${p.enabled ? 'check_circle' : 'close'}" data-action="toggle-prompt" label="${p.enabled ? '禁用' : '启用'}"></mdui-button-icon>
        <mdui-button-icon icon="${isMarker ? 'info' : 'edit'}" data-action="edit-prompt" label="${isMarker ? '查看' : '编辑'}"></mdui-button-icon>
        ${!isBuiltin ? '<mdui-button-icon icon="delete" data-action="delete-prompt" label="删除" style="color: var(--md-sys-color-error);"></mdui-button-icon>' : ''}
      </div>
    </mdui-list-item>
  `;
  }).join('');

  // 拖拽排序
  let dragSrc = null;

  // 拖拽接近列表边缘时自动滚动：滚动容器取最近的 overflow-y: auto/scroll 祖先。
  // 回应配置实际渲染在侧边栏 .sidebar-content__list 内（而非 .control-panel__body），故需通用检测。
  let autoScrollRAF = null;
  let lastDragY = null;
  let activeScrollBox = null;
  const EDGE = 48; // 触发自动滚动的边缘阈值（px）
  const MAX_SPEED = 14; // 每帧最大滚动距离（px）
  const findScrollBox = (el) => {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') return node;
      node = node.parentElement;
    }
    return null;
  };
  const onDragTrack = (e) => {
    lastDragY = e.clientY;
  };
  const stopAutoScroll = () => {
    if (autoScrollRAF != null) cancelAnimationFrame(autoScrollRAF);
    autoScrollRAF = null;
    lastDragY = null;
    if (activeScrollBox) {
      activeScrollBox.removeEventListener('dragover', onDragTrack);
      activeScrollBox = null;
    }
  };
  const autoScrollStep = () => {
    autoScrollRAF = null;
    if (lastDragY != null && activeScrollBox) {
      const rect = activeScrollBox.getBoundingClientRect();
      let delta = 0;
      if (lastDragY < rect.top + EDGE) {
        // 靠近顶部：向上滚动，越接近边缘越快
        delta = -Math.max(1, Math.round(MAX_SPEED * ((rect.top + EDGE - lastDragY) / EDGE)));
      } else if (lastDragY > rect.bottom - EDGE) {
        // 靠近底部：向下滚动
        delta = Math.max(1, Math.round(MAX_SPEED * ((lastDragY - (rect.bottom - EDGE)) / EDGE)));
      }
      if (delta !== 0) activeScrollBox.scrollTop += delta;
    }
    autoScrollRAF = requestAnimationFrame(autoScrollStep);
  };

  container.querySelectorAll('.cp-prompt-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      dragSrc = item;
      item.classList.add('cp-prompt-item--dragging');
      e.dataTransfer.effectAllowed = 'move';
      // 开始拖拽时才检测滚动容器并挂载指针跟踪，确保布局已稳定
      activeScrollBox = findScrollBox(item);
      if (activeScrollBox) {
        activeScrollBox.addEventListener('dragover', onDragTrack);
        if (autoScrollRAF == null) autoScrollRAF = requestAnimationFrame(autoScrollStep);
      }
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('cp-prompt-item--dragging');
      dragSrc = null;
      stopAutoScroll();
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrc && dragSrc !== item) {
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          item.parentNode.insertBefore(dragSrc, item);
        } else {
          item.parentNode.insertBefore(dragSrc, item.nextSibling);
        }
      }
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      // 重新收集顺序
      const newOrder = Array.from(container.querySelectorAll('.cp-prompt-item')).map((el) => el.dataset.id);
      const prompts = loadPrompts();
      const sorted = newOrder.map((id) => prompts.find((p) => p.id === id)).filter(Boolean);
      savePrompts(sorted);
    });

    // 操作按钮
    const id = item.dataset.id;
    item.querySelector('[data-action="toggle-prompt"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const prompts = loadPrompts();
      const target = prompts.find((p) => p.id === id);
      if (target) {
        target.enabled = !target.enabled;
        savePrompts(prompts);
        renderPromptList(container, prompts);
      }
    });
    item.querySelector('[data-action="edit-prompt"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const prompts = loadPrompts();
      const target = prompts.find((p) => p.id === id);
      if (target) showPromptForm(target, () => renderPromptList(container, loadPrompts()));
    });
    item.querySelector('[data-action="delete-prompt"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirm('确定要删除这个提示词吗？', '删除提示词');
      if (!ok) return;
      const prompts = loadPrompts().filter((p) => p.id !== id);
      savePrompts(prompts);
      renderPromptList(container, prompts);
    });
  });
}

function bindEvents(container, settings, prompts) {
  // 滑块实时更新
  container.querySelectorAll('mdui-slider[data-setting]').forEach((slider) => {
    const key = slider.dataset.setting;
    const valueEl = container.querySelector(`[data-value="${key}"]`);
    const hintEl = container.querySelector(`[data-hint="${key}"]`);
    // data-scale 用于把整数 slider 映射回小数（如 0.01 表示 slider value/100 = 真实值）
    const scale = parseFloat(slider.dataset.scale || '1');
    // 自定义 slider 内置 tooltip 显示：把整数转换回真实小数，避免用户看到 100 这样的值
    slider.labelFormatter = (val) => {
      const real = Number((val * scale).toFixed(scale < 1 ? (scale === 0.01 ? 2 : 1) : 0));
      return String(real);
    };
    slider.addEventListener('input', () => {
      // slider 内部用整数 step，无浮点漂移；转回真实小数后再 toFixed 防止 0.01*某整数仍有噪点
      const intVal = parseInt(slider.value, 10);
      const v = Number((intVal * scale).toFixed(scale < 1 ? (scale === 0.01 ? 2 : 1) : 0));
      settings[key] = v;
      if (valueEl) valueEl.textContent = v;
      if (hintEl) hintEl.textContent = v;
    });
  });

  // 数字输入和下拉
  container.querySelectorAll('mdui-text-field[type="number"][data-setting], mdui-select[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    el.addEventListener('change', () => {
      const v = el.type === 'number' ? parseFloat(el.value) : el.value;
      settings[key] = v;
    });
  });

  // 开关
  container.querySelectorAll('mdui-switch[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    el.addEventListener('change', () => {
      settings[key] = el.checked;
    });
  });

  // 显示思维链开关：绑定到用户设置（实时生效，不影响模型思考）
  const showThinkingSwitch = container.querySelector('#cp-show-thinking');
  showThinkingSwitch?.addEventListener('change', () => {
    userSettingsModule.updateSettings({ showThinking: showThinkingSwitch.checked });
  });

  // 预设切换（延迟重渲染，等待 mdui-select 下拉框关闭完成）
  container.querySelector('#cp-preset-select')?.addEventListener('change', (e) => {
    const name = e.target.value;
    saveActivePreset(name);
    applyActivePresetRegex();
    setTimeout(() => renderResponseConfig(container, { force: true }), 100);
  });

  // 保存预设
  container.querySelector('#cp-preset-save')?.addEventListener('click', () => {
    const presets = loadPresets();
    const name = loadActivePreset();
    const idx = presets.findIndex((p) => p.name === name);
    if (idx >= 0) {
      presets[idx].settings = { ...settings };
      savePresets(presets);
      showSuccess(`预设"${name}"已保存`);
    } else {
      // 新名称保存
      showPresetSaveForm(name, settings, container);
    }
  });

  // 新建预设
  container.querySelector('#cp-preset-new')?.addEventListener('click', () => {
    showPresetSaveForm('', settings, container);
  });

  // 删除预设
  container.querySelector('#cp-preset-delete')?.addEventListener('click', async () => {
    const name = loadActivePreset();
    if (name === 'Default') {
      showError('不能删除默认预设');
      return;
    }
    const ok = await confirm(`确定要删除预设"${name}"吗？`, '删除预设');
    if (!ok) return;
    const presets = loadPresets().filter((p) => p.name !== name);
    savePresets(presets);
    saveActivePreset('Default');
    renderResponseConfig(container, { force: true });
    showSuccess('已删除');
  });

  // 导出预设（SillyTavern 格式，含采样参数 + 提示词 + 正则脚本）
  container.querySelector('#cp-preset-export')?.addEventListener('click', () => {
    const name = loadActivePreset();
    const presets = loadPresets();
    const preset = presets.find((p) => p.name === name) || presets[0];
    if (!preset) {
      showError('没有可导出的预设');
      return;
    }
    const currentPrompts = loadPrompts();
    const currentRegex = appState.get('regexScripts') || [];
    const stData = presetToSillyTavern(preset.settings, name, currentPrompts, currentRegex);
    downloadJson(stData, `${name}.json`);
    const parts = [`${currentPrompts.length} 条提示词`];
    if (currentRegex.length > 0) parts.push(`${currentRegex.length} 条正则`);
    showSuccess(`预设"${name}"已导出（含 ${parts.join('、')}）`);
  });

  // 导入预设（SillyTavern 格式）
  const importInput = container.querySelector('#cp-preset-import-input');
  container.querySelector('#cp-preset-import')?.addEventListener('click', () => {
    importInput?.click();
  });
  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const newSettings = sillyTavernToSettings(data);
      const name = (data.preset || file.name.replace(/\.json$/i, '')).trim() || '导入的预设';
      // 解析提示词：SillyTavern 文件即使 prompts 为空，只要有 prompt_order 也应还原内置提示词
      const hasPromptData = Array.isArray(data.prompts) || Array.isArray(data.prompt_order);
      const newPrompts = hasPromptData ? sillyTavernToPrompts(data) : null;
      // 解析正则脚本
      const newRegexScripts = sillyTavernToRegexScripts(data);

      // 导入的提示词直接挂到导入的预设上，不影响其它预设（预设间互不干扰）
      const presets = loadPresets();
      const idx = presets.findIndex((p) => p.name === name);
      if (idx >= 0) {
        presets[idx].settings = newSettings;
        if (newPrompts) presets[idx].prompts = newPrompts;
        if (newRegexScripts) presets[idx].regexScripts = newRegexScripts;
      } else {
        presets.push({
          name,
          settings: newSettings,
          prompts: newPrompts || DEFAULT_PROMPTS.map((p) => ({ ...p })),
          regexScripts: newRegexScripts || undefined,
        });
      }
      savePresets(presets);
      saveActivePreset(name);

      // 导入后立即加载该预设的正则脚本
      applyActivePresetRegex();

      renderResponseConfig(container, { force: true });
      const parts = [];
      if (newPrompts) parts.push(`${newPrompts.length} 条提示词`);
      if (newRegexScripts) parts.push(`${newRegexScripts.length} 条正则`);
      showSuccess(parts.length > 0
        ? `预设"${name}"已导入（含 ${parts.join('、')}）`
        : `预设"${name}"已导入`);
    } catch (err) {
      showError('导入失败：文件不是有效的 JSON 预设');
    }
    // 重置 input 以便重复导入同一文件
    e.target.value = '';
  });

  // 添加提示词
  container.querySelector('#cp-prompt-add')?.addEventListener('click', () => {
    showPromptForm(null, () => renderPromptList(container.querySelector('#cp-prompt-list'), loadPrompts()));
  });

  // 应用到当前对话
  container.querySelector('#cp-apply-settings')?.addEventListener('click', async () => {
    const conv = appState.get('currentConversation');
    if (!conv) {
      showError('请先选择一个对话');
      return;
    }
    try {
      // 更新对话的 LLM 配置 extraParams
      const llmConfigs = appState.get('llmConfigs') || [];
      const llmConfig = llmConfigs.find((c) => c.id === conv.llmConfigId);
      if (!llmConfig) {
        showError('找不到对话的 LLM 配置');
        return;
      }
      const extraParams = { ...(llmConfig.extraParams || {}) };
      extraParams.temperature = settings.temperature;
      extraParams.topP = settings.topP;
      extraParams.topK = settings.topK;
      extraParams.minP = settings.minP;
      extraParams.maxTokens = settings.maxResponseTokens;
      extraParams.maxContextTokens = settings.maxContextTokens;
      extraParams.repetitionPenalty = settings.repetitionPenalty;
      extraParams.frequencyPenalty = settings.frequencyPenalty;
      extraParams.presencePenalty = settings.presencePenalty;
      extraParams.stream = settings.stream;

      // 思维链参数始终传给模型（显示开关只控制前端可见性，不影响模型思考）
      extraParams.thinking = { type: 'enabled', budget_tokens: settings.thinkingBudget };
      extraParams.reasoningEffort = settings.reasoningEffort;

      await llmConfigApi.update(llmConfig.id, { extraParams });

      // 同步 Prompt Manager 的 prompts 列表到对话 settings.prompts
      const currentPrompts = loadPrompts();
      await conversationApi.update(conv.id, {
        settings: {
          ...conv.settings,
          prompts: currentPrompts,
        },
      });
      // 更新本地缓存的对话对象，避免下次 apply 时 settings.prompts 被旧值覆盖
      conv.settings = { ...conv.settings, prompts: currentPrompts };
      appState.set('currentConversation', { ...conv });

      showSuccess('已应用：LLM 参数 + Prompt Manager 已同步到当前对话');
    } catch (err) {
      showError(err.message || '应用失败');
    }
  });

  // 设为默认
  container.querySelector('#cp-save-default')?.addEventListener('click', () => {
    const presets = loadPresets();
    const name = loadActivePreset();
    const idx = presets.findIndex((p) => p.name === name);
    if (idx >= 0) {
      presets[idx].settings = { ...settings };
      savePresets(presets);
    }
    showSuccess('已保存为默认设置');
  });

  // 重置默认预设（仅默认预设显示此按钮）：同时重置采样参数与提示词列表
  container.querySelector('#cp-reset-default')?.addEventListener('click', async () => {
    const ok = await confirm('确定要将默认预设恢复为初始设置吗？当前默认预设的采样参数与提示词列表的修改都将被丢弃。', '重置默认预设');
    if (!ok) return;
    const presets = loadPresets();
    const idx = presets.findIndex((p) => p.name === 'Default');
    const resetPrompts = DEFAULT_PROMPTS.map((p) => ({ ...p }));
    if (idx >= 0) {
      presets[idx].settings = JSON.parse(JSON.stringify(DEFAULT_PRESET.settings));
      presets[idx].prompts = resetPrompts;
    } else {
      presets.unshift({ name: 'Default', settings: JSON.parse(JSON.stringify(DEFAULT_PRESET.settings)), prompts: resetPrompts });
    }
    savePresets(presets);
    saveActivePreset('Default');
    renderResponseConfig(container, { force: true });
    showSuccess('默认预设已重置（含提示词）');
  });
}

function showPresetSaveForm(defaultName, settings, container) {
  showModal({
    title: '保存预设',
    content: `
      <div class="mgmt-form">
        <div class="form-group">
          <label class="form-group__label">预设名称</label>
          <mdui-text-field variant="outlined" id="preset-name" value="${escapeHtml(defaultName)}" placeholder="如：创意写作"></mdui-text-field>
        </div>
      </div>
    `,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: '保存', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', () => {
        const name = dialog.querySelector('#preset-name').value.trim();
        if (!name) {
          showError('名称不能为空');
          return;
        }
        const presets = loadPresets();
        const idx = presets.findIndex((p) => p.name === name);
        // 新预设继承当前激活预设的提示词列表作为起点（之后可独立编辑，互不干扰）
        const newPreset = { name, settings: { ...settings }, prompts: loadPrompts() };
        if (idx >= 0) {
          presets[idx] = newPreset;
        } else {
          presets.push(newPreset);
        }
        savePresets(presets);
        saveActivePreset(name);
        close('saved');
        renderResponseConfig(container, { force: true });
        showSuccess(`预设"${name}"已保存`);
      });
    },
  });
}

function showPromptForm(prompt, callback) {
  // marker 提示词：内容从其他地方（世界书/角色卡/对话历史）提取，不可编辑
  // - chatHistory：显示对话历史查看视图
  // - 其它 marker：显示内容来源说明，仅可开关 enabled
  if (prompt && (prompt.marker || MARKER_PROMPT_IDS.has(prompt.id))) {
    if (prompt.id === 'chatHistory') {
      showChatHistoryView();
    } else {
      showMarkerInfo(prompt, callback);
    }
    return;
  }
  const isEdit = !!prompt;
  const p = prompt || {
    id: 'prompt_' + Date.now(),
    name: '',
    role: 'system',
    content: '',
    enabled: true,
    injection_position: 0,
    injection_depth: 0,
    injection_order: 100,
  };

  showModal({
    title: isEdit ? '编辑提示词' : '添加提示词',
    content: `
      <div class="mgmt-form">
        <div class="form-group">
          <label class="form-group__label">名称 *</label>
          <mdui-text-field variant="outlined" id="prompt-name" value="${escapeHtml(p.name)}" placeholder="如：角色描述"></mdui-text-field>
        </div>
        <div class="mgmt-form__row">
          <div class="form-group">
            <label class="form-group__label">角色</label>
            <mdui-select id="prompt-role" variant="outlined" value="${p.role}">
              <mdui-menu-item value="system">System</mdui-menu-item>
              <mdui-menu-item value="user">User</mdui-menu-item>
              <mdui-menu-item value="assistant">Assistant</mdui-menu-item>
            </mdui-select>
          </div>
          <div class="form-group">
            <label class="form-group__label">注入位置</label>
            <mdui-select id="prompt-position" variant="outlined" value="${p.injection_position}">
              <mdui-menu-item value="0">相对（系统提示）</mdui-menu-item>
              <mdui-menu-item value="1">聊天内（指定深度）</mdui-menu-item>
            </mdui-select>
          </div>
          <div class="form-group">
            <label class="form-group__label">注入深度</label>
            <mdui-text-field variant="outlined" type="number" id="prompt-depth" value="${p.injection_depth}" min="0" max="50"></mdui-text-field>
          </div>
          <div class="form-group">
            <label class="form-group__label">注入顺序</label>
            <mdui-text-field variant="outlined" type="number" id="prompt-order" value="${p.injection_order}" min="0" max="1000"></mdui-text-field>
          </div>
        </div>
        <div class="form-group">
          <mdui-text-field id="prompt-content" label="内容" variant="outlined" rows="6" autosize max-rows="15" placeholder="支持宏：{{char}}, {{user}}, {{description}} 等" value="${escapeHtml(p.content)}"></mdui-text-field>
        </div>
        <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
          <mdui-switch id="prompt-enabled" ${p.enabled ? 'checked' : ''}></mdui-switch>
          <span style="font-size: 14px;">启用此提示词</span>
        </label>
      </div>
    `,
    actions: [
      { text: '取消', value: 'cancel', type: 'text' },
      { text: isEdit ? '保存' : '添加', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', () => {
        const name = dialog.querySelector('#prompt-name').value.trim();
        if (!name) {
          showError('名称不能为空');
          return;
        }
        const updated = {
          ...p,
          name,
          role: dialog.querySelector('#prompt-role').value,
          content: dialog.querySelector('#prompt-content').value,
          enabled: dialog.querySelector('#prompt-enabled').checked,
          injection_position: parseInt(dialog.querySelector('#prompt-position').value, 10),
          injection_depth: parseInt(dialog.querySelector('#prompt-depth').value, 10) || 0,
          injection_order: parseInt(dialog.querySelector('#prompt-order').value, 10) || 100,
        };

        const prompts = loadPrompts();
        const idx = prompts.findIndex((pr) => pr.id === p.id);
        if (idx >= 0) {
          prompts[idx] = updated;
        } else {
          prompts.push(updated);
        }
        savePrompts(prompts);
        close('saved');
        if (callback) callback();
        showSuccess(isEdit ? '已保存' : '已添加');
      });
    },
  });
}

/**
 * marker 提示词查看：显示内容来源说明，仅可开关 enabled（内容不可编辑）
 */
function showMarkerInfo(prompt, callback) {
  const desc = MARKER_DESCRIPTIONS[prompt.id] || '此提示词为系统占位符，内容自动提取，无法在此处编辑。';
  showModal({
    title: prompt.name,
    content: `
      <div class="mgmt-form">
        <div style="padding: 12px 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; line-height: 1.6;">
          ${escapeHtml(desc)}
        </div>
        <label style="display: flex; align-items: center; gap: var(--md-sys-spacing-2); cursor: pointer;">
          <mdui-switch id="marker-enabled" ${prompt.enabled ? 'checked' : ''}></mdui-switch>
          <span style="font-size: 14px;">启用此提示词</span>
        </label>
      </div>
    `,
    actions: [
      { text: '关闭', value: 'cancel', type: 'text' },
      { text: '保存', value: 'save', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="save"]').addEventListener('click', () => {
        const enabled = dialog.querySelector('#marker-enabled').checked;
        const prompts = loadPrompts();
        const idx = prompts.findIndex((p) => p.id === prompt.id);
        if (idx >= 0) {
          prompts[idx].enabled = enabled;
          savePrompts(prompts);
        }
        close('saved');
        if (callback) callback();
      });
    },
  });
}

/**
 * Chat History 查看视图：只读展示当前对话的全部消息（用户与智能体的往返）
 */
function showChatHistoryView() {
  const conv = appState.get('currentConversation');
  const messages = conv?.messages || [];
  const listHtml = messages.length === 0
    ? '<div class="cp-empty"><div class="cp-empty__title">暂无对话历史</div><div class="cp-empty__desc">此对话还没有消息</div></div>'
    : messages.map((m) => {
        const roleLabel = m.role === 'user' ? '用户' : m.role === 'assistant' ? '智能体' : '系统';
        return `
          <div class="cp-chat-history__item cp-chat-history__item--${m.role}">
            <span class="cp-chat-history__role">${roleLabel}</span>
            <div class="cp-chat-history__content">${escapeHtml(m.content || '')}</div>
          </div>
        `;
      }).join('');

  showModal({
    title: 'Chat History（对话历史）',
    content: `
      <div class="cp-chat-history">
        ${listHtml}
      </div>
    `,
    actions: [
      { text: '关闭', value: 'close', type: 'filled' },
    ],
    onMount: (dialog, close) => {
      dialog.querySelector('[data-action="close"]')?.addEventListener('click', () => close('close'));
    },
  });
}

export default { renderResponseConfig };
