/**
 * HTTP 请求封装
 * 支持 JWT 认证、自动刷新 token、错误处理
 */

const BASE_URL = '/api';
const TOKEN_KEY = 'smarttavern_access_token';
const REFRESH_TOKEN_KEY = 'smarttavern_refresh_token';

/**
 * 获取存储的 token
 */
export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken, refreshToken) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * 检查是否已登录
 */
export function isAuthenticated() {
  return !!getAccessToken();
}

/**
 * 刷新 Access Token
 */
let refreshPromise = null;

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearTokens();
    return null;
  }

  refreshPromise = fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success && data.data.accessToken) {
        setTokens(data.data.accessToken);
        return data.data.accessToken;
      }
      clearTokens();
      return null;
    })
    .catch(() => {
      clearTokens();
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

/**
 * 统一请求函数
 */
export async function request(url, options = {}) {
  const token = getAccessToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers,
  };

  let response = await fetch(`${BASE_URL}${url}`, config);

  // Token 过期，尝试刷新
  if (response.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(`${BASE_URL}${url}`, config);
    } else {
      // 刷新失败，跳转登录
      redirectToLogin();
      throw new Error('登录已过期，请重新登录');
    }
  }

  // 处理非 JSON 响应
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  }

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error?.message || `HTTP ${response.status}`);
    error.code = data.error?.code;
    error.status = response.status;
    error.details = data.error?.details;
    throw error;
  }

  if (!data.success) {
    const error = new Error(data.error?.message || '请求失败');
    error.code = data.error?.code;
    throw error;
  }

  return data.data;
}

/**
 * GET 请求
 */
export function get(url, params) {
  let queryString = '';
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    queryString = searchParams.toString();
    if (queryString) queryString = `?${queryString}`;
  }
  return request(`${url}${queryString}`);
}

/**
 * POST 请求
 */
export function post(url, body) {
  return request(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * PUT 请求
 */
export function put(url, body) {
  return request(url, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * DELETE 请求
 */
export function del(url, body) {
  return request(url, { method: 'DELETE', ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
}

/**
 * 流式 POST 请求（SSE）
 * 用于聊天消息流式输出
 * @param {AbortSignal} [signal] 可选的 AbortSignal，用于取消请求
 */
export async function postStream(url, body, callbacks = {}, signal) {
  const { onChunk, onThinking, onMessageId, onMemoryGenerating, onMemoryDone, onDone, onError } = callbacks;
  const token = getAccessToken();

  const response = await fetch(`${BASE_URL}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err = new Error(errorData.error?.message || `HTTP ${response.status}`);
    if (onError) onError(err);
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        try {
          const data = JSON.parse(trimmed.slice(5).trim());
          if (data.type === 'message_id' && onMessageId) {
            onMessageId(data.messageId);
          } else if (data.type === 'chunk' && onChunk) {
            onChunk(data.content);
          } else if (data.type === 'thinking' && onThinking) {
            onThinking(data.content);
          } else if (data.type === 'memory_generating' && onMemoryGenerating) {
            onMemoryGenerating();
          } else if (data.type === 'memory_done' && onMemoryDone) {
            onMemoryDone();
          } else if (data.type === 'done' && onDone) {
            onDone(data);
          } else if (data.type === 'error' && onError) {
            onError(new Error(data.message));
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }

    // 流结束后处理 buffer 中残留的数据（防止最后一条事件未被处理）
    const remaining = buffer.trim();
    if (remaining && remaining.startsWith('data:')) {
      try {
        const data = JSON.parse(remaining.slice(5).trim());
        if (data.type === 'done' && onDone) {
          onDone(data);
        } else if (data.type === 'error' && onError) {
          onError(new Error(data.message));
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  } catch (err) {
    // AbortError 时调用 onError（如果存在）以便上层清理
    if (err.name === 'AbortError') {
      if (onError) onError(err);
    } else {
      throw err;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 跳转登录页
 */
function redirectToLogin() {
  if (!window.location.pathname.includes('/login') &&
      !window.location.pathname.includes('/register')) {
    window.location.href = '/login';
  }
}

/**
 * 文件上传
 */
export async function upload(url, file, fieldName = 'file') {
  const token = getAccessToken();
  const formData = new FormData();
  formData.append(fieldName, file);

  const response = await fetch(`${BASE_URL}${url}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error?.message || '上传失败');
  }
  return data.data;
}
