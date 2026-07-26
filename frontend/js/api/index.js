/**
 * API 接口封装
 */
import { get, post, put, del, postStream, upload, getAccessToken } from '../utils/request.js';

// ============ 认证 ============
export const authApi = {
  register: (username, password) => post('/auth/register', { username, password }),
  login: (username, password) => post('/auth/login', { username, password }),
  logout: () => post('/auth/logout'),
  me: () => get('/auth/me'),
  refreshToken: (refreshToken) => post('/auth/refresh', { refreshToken }),
  updatePassword: (oldPassword, newPassword) => put('/auth/password', { oldPassword, newPassword }),
  forcePassword: (newPassword) => put('/auth/force-password', { newPassword }),
};

// ============ 用户 ============
export const userApi = {
  list: (params) => get('/users', params),
  get: (id) => get(`/users/${id}`),
  create: (username) => post('/users/create', { username }),
  update: (id, data) => put(`/users/${id}`, data),
  delete: (id) => del(`/users/${id}`),
  updateRole: (id, role) => put(`/users/${id}/role`, { role }),
  getRegexScripts: (id) => get(`/users/${id}/regex`),
  saveRegexScripts: (id, scripts) => put(`/users/${id}/regex`, { scripts }),
};

// ============ 系统 ============
export const systemApi = {
  getRegistration: () => get('/system/registration'),
  getConfig: () => get('/system/config'),
  updateConfig: (data) => put('/system/config', data),
};

// ============ 角色卡 ============
export const characterApi = {
  list: (params) => get('/characters', params),
  get: (id) => get(`/characters/${id}`),
  create: (data) => post('/characters', data),
  update: (id, data) => put(`/characters/${id}`, data),
  delete: (id) => del(`/characters/${id}`),
  import: (data) => post('/characters/import', data),
  export: (id) => get(`/characters/${id}/export`),
};

// ============ 世界书 ============
export const worldbookApi = {
  list: (params) => get('/worldbooks', params),
  get: (id) => get(`/worldbooks/${id}`),
  create: (data) => post('/worldbooks', data),
  update: (id, data) => put(`/worldbooks/${id}`, data),
  delete: (id) => del(`/worldbooks/${id}`),
  import: (data) => post('/worldbooks/import', data),
  export: (id) => get(`/worldbooks/${id}/export`),
  addEntry: (id, entry) => post(`/worldbooks/${id}/entries`, entry),
  updateEntry: (id, entryUid, data) => put(`/worldbooks/${id}/entries/${entryUid}`, data),
  deleteEntry: (id, entryUid) => del(`/worldbooks/${id}/entries/${entryUid}`),
};

// ============ LLM 配置 ============
export const llmConfigApi = {
  list: () => get('/llm-configs'),
  create: (data) => post('/llm-configs', data),
  update: (id, data) => put(`/llm-configs/${id}`, data),
  delete: (id) => del(`/llm-configs/${id}`),
  test: (id) => post(`/llm-configs/${id}/test`),
};

// ============ 对话 ============
export const conversationApi = {
  list: (params) => get('/conversations', params),
  get: (id) => get(`/conversations/${id}`),
  create: (data) => post('/conversations', data),
  update: (id, data) => put(`/conversations/${id}`, data),
  delete: (id) => del(`/conversations/${id}`),
  export: async (id, format = 'json') => {
    const token = getAccessToken();
    const response = await fetch(`/api/conversations/${id}/export?format=${format}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!response.ok) throw new Error(`导出失败: HTTP ${response.status}`);
    return response;
  },
  import: (characterId, data, llmConfigId, title) => post('/conversations/import', { characterId, data, llmConfigId, title }),
  sendMessage: (id, content, callbacks, signal, extraBody) => postStream(`/conversations/${id}/messages`, { content, ...extraBody }, callbacks, signal),
  regenerate: (id, callbacks, signal, extraBody) => postStream(`/conversations/${id}/regenerate`, { ...extraBody }, callbacks, signal),
  continue: (id, callbacks, signal, extraBody) => postStream(`/conversations/${id}/continue`, { ...extraBody }, callbacks, signal),
  aiHelp: (id, callbacks, signal, body) => postStream(`/conversations/${id}/ai-help`, { ...body }, callbacks, signal),
  deleteMessage: (id, msgId) => del(`/conversations/${id}/messages/${msgId}`),
  updateMessage: (id, msgId, content) => put(`/conversations/${id}/messages/${msgId}`, { content }),
  swipe: (id, callbacks, signal, extraBody) => postStream(`/conversations/${id}/swipe`, { ...extraBody }, callbacks, signal),
  switchSwipe: (id, msgId, swipeIndex) => put(`/conversations/${id}/messages/${msgId}/swipe`, { swipeIndex }),
  // ============ 记忆功能 ============
  getMemory: (id) => get(`/conversations/${id}/memory`),
  updateMemory: (id, memory) => put(`/conversations/${id}/memory`, { memory }),
  generateSummary: (id) => post(`/conversations/${id}/memory/summaries`),
  updateSummary: (id, summaryId, content) => put(`/conversations/${id}/memory/summaries/${summaryId}`, { content }),
  deleteSummary: (id, summaryId) => del(`/conversations/${id}/memory/summaries/${summaryId}`),
};

// ============ 文件上传 ============
export const fileApi = {
  uploadAvatar: (file) => upload('/files/avatar', file, 'file'),
  uploadCharacterImage: (file) => upload('/files/character', file, 'file'),
  deleteFile: (url) => del('/files', { url }),
};

// ============ 缓存统计 ============
export const cacheApi = {
  getOverview: (days = 90) => get('/cache/overview', { days }),
  getConversation: (id) => get(`/cache/conversation/${id}`),
};

export default {
  auth: authApi,
  user: userApi,
  character: characterApi,
  worldbook: worldbookApi,
  llmConfig: llmConfigApi,
  conversation: conversationApi,
  file: fileApi,
  cache: cacheApi,
};
