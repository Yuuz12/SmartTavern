/**
 * 缓存统计模块
 * 展示对话级缓存命中率、全局缓存用量、Token 统计、聊天热力图
 *
 * 数据来源：
 * - 对话级：GET /api/cache/conversation/:id（聚合 message.metadata 中的缓存字段）
 * - 全局+热力图：GET /api/cache/overview?days=30
 *
 * 缓存命中由后端 streamLLMResponse 在每次 LLM 请求时基于上下文前缀匹配判定，
 * 写入 message.metadata.{promptTokens, completionTokens, cachedTokens, cacheHit}。
 * 前端仅做展示与按需刷新。
 */
import appState from '../stores/appState.js';
import { cacheApi } from '../api/index.js';
import { showError } from '../components/Toast.js';
import { escapeHtml, formatRelativeTime, debounce } from '../utils/helpers.js';

// ============ 状态 ============

let currentConvStats = null;
let currentOverview = null;
let isLoading = false;
let streamDoneListenerBound = false;

// ============ 辅助函数 ============

function getConvId() {
  const conv = appState.get('currentConversation');
  return conv?.id || null;
}

/** 数字格式化为 K 单位 */
function formatK(n) {
  if (n == null || isNaN(n)) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1000).toFixed(0) + 'K';
}

/** 百分比 */
function formatPercent(rate) {
  if (rate == null || isNaN(rate)) return '0.0%';
  return (rate * 100).toFixed(1) + '%';
}

/** 根据 count 与 max 计算热力图等级 0-4 */
function heatLevel(count, max) {
  if (!count || count <= 0) return 0;
  if (max <= 0) return 0;
  const r = count / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

// ============ 主渲染函数 ============

export async function renderCache(container, opts = {}) {
  const convId = getConvId();

  container.innerHTML = `
    <div style="display: flex; justify-content: center; padding: 32px;">
      <mdui-circular-progress></mdui-circular-progress>
    </div>`;

  // 绑定流式完成事件（仅一次）
  bindStreamDoneListener();

  try {
    const tasks = [cacheApi.getOverview(90)];
    if (convId) tasks.push(cacheApi.getConversation(convId));
    const [overviewRes, convRes] = await Promise.all(tasks);
    currentOverview = overviewRes;
    currentConvStats = convRes || null;
  } catch (err) {
    container.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty__title">加载失败</div>
        <div class="cp-empty__desc">${escapeHtml(err.message || '无法加载缓存统计')}</div>
      </div>`;
    return;
  }

  renderContent(container);
}

function renderContent(container) {
  const convId = getConvId();
  const g = currentOverview?.global || {};
  const heatmap = currentOverview?.heatmap || [];

  container.innerHTML = `
    <div class="cp-toolbar">
      <span class="cp-toolbar__title">缓存统计</span>
      <mdui-button-icon icon="refresh" id="cp-cache-refresh" label="刷新"></mdui-button-icon>
    </div>

    <!-- 功能说明提示 -->
    <div class="cp-cache-notice">
      <mdui-icon name="info" class="cp-cache-notice__icon"></mdui-icon>
      <span>本功能仅作缓存命中的<strong>预估</strong>，并非实际缓存。实际命中受 LLM 供应商的缓存逻辑、缓存保存时长及计费策略影响，数据仅供参考。</span>
    </div>

    <!-- 对话级缓存命中率 -->
    <div class="cp-section">
      <h3 class="cp-section__title">对话缓存命中率</h3>
      <div id="cp-cache-headline"></div>
    </div>

    <!-- 全局统计 -->
    <div class="cp-section">
      <h3 class="cp-section__title">全局缓存用量</h3>
      <div id="cp-cache-stats"></div>
      <div id="cp-cache-bar"></div>
    </div>

    <!-- 聊天热力图 -->
    <div class="cp-section">
      <div class="cp-cache-heatmap__header">
        <h3 class="cp-section__title">聊天热力图（最近 3 个月）</h3>
        <div id="cp-cache-heatmap-legend"></div>
      </div>
      <div id="cp-cache-heatmap"></div>
    </div>

    <!-- 最近消息缓存明细 -->
    <div class="cp-section" id="cp-cache-messages-section"></div>
  `;

  renderHeadline(container, convId);
  renderStatCards(container, g);
  renderTokenBar(container, g);
  renderHeatmap(container, heatmap);
  renderMessageList(container, convId);

  container.querySelector('#cp-cache-refresh')?.addEventListener('click', () => {
    renderCache(container, { force: true });
  });
}

// ============ 对话命中率环 ============

function renderHeadline(container, convId) {
  const el = container.querySelector('#cp-cache-headline');
  if (!el) return;

  if (!convId || !currentConvStats) {
    el.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty__title">请先选择对话</div>
        <div class="cp-empty__desc">选择对话后将展示该对话的缓存命中率</div>
      </div>`;
    return;
  }

  const s = currentConvStats;
  const rate = s.hitRate || 0;
  // SVG 环：半径 50，周长 ≈ 314.16
  const r = 50;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - rate);

  el.innerHTML = `
    <div class="cp-cache-headline">
      <div class="cp-cache-ring">
        <svg class="cp-cache-ring__svg" viewBox="0 0 120 120">
          <circle class="cp-cache-ring__track" cx="60" cy="60" r="${r}"></circle>
          <circle class="cp-cache-ring__progress" cx="60" cy="60" r="${r}"
            stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
        </svg>
        <div class="cp-cache-ring__label">
          <div class="cp-cache-ring__value">${formatPercent(rate)}</div>
          <div class="cp-cache-ring__sub">命中率</div>
        </div>
      </div>
      <div class="cp-cache-headline__info">
        <div class="cp-cache-headline__title">当前对话缓存使用</div>
        <div class="cp-cache-headline__desc">
          命中 <strong>${s.hitCount}</strong> / 共 <strong>${s.trackedMessages}</strong> 次请求
          · 消息 <strong>${s.totalMessages}</strong> 条（用户 ${s.userMessageCount || 0} · AI ${s.assistantMessageCount || 0}）<br>
          输入 ${formatK(s.inputTokens)} Token · 输出 ${formatK(s.outputTokens)} Token · 节省 ${formatK(s.savedTokens)} Token
        </div>
        <div class="cp-cache-headline__hint">
          命中率基于 LLM 请求次数（每次 AI 回复对应一次请求，用户消息作为上下文参与命中判定）。正常追加消息时命中率趋近 100%；启用记忆截断、编辑/删除历史消息会降低命中率（但减少总输入 Token）。<br>
          <strong>提升命中率建议：</strong>若 LLM 提供商缓存服务完善、命中价格低且模型上下文长度大，可拉高最大发送层数与总结间隔，避免频繁总结破坏缓存命中，甚至可关闭记忆功能以最大化命中率；若提供商缓存服务较差且上下文长度小，则适当拉小最大发送层数与总结间隔（但不宜过小，以免频繁截断反而打断缓存链），具体取值请结合自身命中率表现权衡。
        </div>
      </div>
    </div>
  `;
}

// ============ 全局统计卡片 ============

function renderStatCards(container, g) {
  const el = container.querySelector('#cp-cache-stats');
  if (!el) return;

  const cards = [
    {
      label: '总对话数',
      value: String(g.totalConversations || 0),
      icon: 'forum',
      iconCls: '',
    },
    {
      label: '总信息数',
      value: String(g.totalMessages || 0),
      icon: 'message',
      iconCls: 'cp-cache-stat-card__icon--secondary',
    },
    {
      label: '输入 Token',
      value: formatK(g.inputTokens || 0),
      icon: 'login',
      iconCls: '',
    },
    {
      label: '输出 Token',
      value: formatK(g.outputTokens || 0),
      icon: 'logout',
      iconCls: 'cp-cache-stat-card__icon--tertiary',
    },
    {
      label: '缓存节省 Token',
      value: formatK(g.savedTokens || 0),
      icon: 'bolt',
      iconCls: 'cp-cache-stat-card__icon--secondary',
    },
    {
      label: '全局缓存命中率',
      value: formatPercent(g.globalHitRate || 0),
      icon: 'cached',
      iconCls: '',
    },
  ];

  el.innerHTML = `<div class="cp-cache-stats">${cards
    .map(
      (c) => `
      <mdui-card class="cp-cache-stat-card" variant="filled">
        <div class="cp-cache-stat-card__icon ${c.iconCls}">
          <mdui-icon name="${c.icon}"></mdui-icon>
        </div>
        <div class="cp-cache-stat-card__body">
          <div class="cp-cache-stat-card__value">${escapeHtml(c.value)}</div>
          <div class="cp-cache-stat-card__label">${escapeHtml(c.label)}</div>
        </div>
      </mdui-card>`,
    )
    .join('')}</div>`;
}

// ============ Token 分布堆叠条 ============

function renderTokenBar(container, g) {
  const el = container.querySelector('#cp-cache-bar');
  if (!el) return;

  const input = g.inputTokens || 0;
  const output = g.outputTokens || 0;
  const saved = g.savedTokens || 0;
  // savedTokens 为命中请求复用的输入+输出（已计入 input/output），此处拆分为互斥两段：
  // 实际消耗 = 总 token - 节省；缓存节省 = 命中请求复用部分
  const consumed = Math.max(0, input + output - saved);
  const total = consumed + saved || 1;

  const seg = (cls, val) =>
    `<div class="cp-cache-bar__seg ${cls}" style="width: ${((val / total) * 100).toFixed(2)}%"></div>`;

  el.innerHTML = `
    <div class="cp-cache-bar">
      ${seg('cp-cache-bar__seg--input', consumed)}
      ${seg('cp-cache-bar__seg--saved', saved)}
    </div>
    <div class="cp-cache-bar__legend">
      <div class="cp-cache-bar__legend-item">
        <span class="cp-cache-bar__legend-dot" style="background-color: rgb(var(--mdui-color-primary, 103 80 164));"></span>
        实际消耗 ${formatK(consumed)}
      </div>
      <div class="cp-cache-bar__legend-item">
        <span class="cp-cache-bar__legend-dot" style="background-color: rgb(var(--mdui-color-secondary, 98 91 113));"></span>
        缓存节省 ${formatK(saved)}
      </div>
    </div>
  `;
}

// ============ 聊天热力图 ============

/**
 * 一周从周一开始：周一=0, 周二=1, ..., 周日=6
 * 这样周日永远在每列最后一行，今天（若为周日）落在最右下角
 */
function mondayFirstOffset(date) {
  return (date.getDay() + 6) % 7;
}

function renderHeatmap(container, heatmap) {
  const el = container.querySelector('#cp-cache-heatmap');
  if (!el) return;

  if (!heatmap || heatmap.length === 0) {
    el.innerHTML = `<div class="cp-empty"><div class="cp-empty__desc">暂无数据</div></div>`;
    return;
  }

  const max = heatmap.reduce((m, d) => Math.max(m, d.count || 0), 0);

  // 首日在一周（周一起）中的位置：左上角不足一周的部分用隐藏格子对齐
  const firstDate = new Date(heatmap[0].date + 'T00:00:00');
  const firstDayOffset = isNaN(firstDate.getTime()) ? 0 : mondayFirstOffset(firstDate);

  // 生成单元格：左上角多隐藏（对齐到周一）；最后一列少不补（不到周日不补齐）
  const cells = [];
  for (let i = 0; i < firstDayOffset; i++) {
    cells.push(`<div class="cp-cache-heatmap__cell cp-cache-heatmap__cell--empty" style="visibility:hidden;"></div>`);
  }
  for (const d of heatmap) {
    const level = heatLevel(d.count || 0, max);
    const cls = level === 0 ? 'cp-cache-heatmap__cell--empty' : `cp-cache-heatmap__cell--l${level}`;
    cells.push(
      `<div class="cp-cache-heatmap__cell ${cls}" title="${escapeHtml(d.date)}：${d.count || 0} 条消息"></div>`,
    );
  }

  // 月份标签：本月首日所在列若与上一标签同列（同列跨月），推迟到下一列，避免视觉重叠
  const COL_STRIDE = 17; // 14px 格子 + 3px gap（与 CSS 一致）
  const monthLabels = [];
  let lastMonthKey = '';
  let lastLabelCol = -1;
  for (let i = 0; i < heatmap.length; i++) {
    const monthKey = heatmap[i].date.slice(0, 7); // YYYY-MM
    if (monthKey !== lastMonthKey) {
      lastMonthKey = monthKey;
      let colIdx = Math.floor((i + firstDayOffset) / 7);
      if (colIdx <= lastLabelCol) colIdx = lastLabelCol + 1; // 与上一标签同列则右移一格
      const monthNum = parseInt(heatmap[i].date.slice(5, 7), 10);
      monthLabels.push({ col: colIdx, label: `${monthNum}月` });
      lastLabelCol = colIdx;
    }
  }
  const monthsHtml = monthLabels
    .map((m) => `<span class="cp-cache-heatmap__month" style="left: ${m.col * COL_STRIDE}px;">${m.label}</span>`)
    .join('');

  el.innerHTML = `
    <div class="cp-cache-heatmap">
      <div class="cp-cache-heatmap__months">${monthsHtml}</div>
      <div class="cp-cache-heatmap__body">
        <div class="cp-cache-heatmap__weekdays">
          <span>一</span>
          <span></span>
          <span>三</span>
          <span></span>
          <span>五</span>
          <span></span>
          <span>日</span>
        </div>
        <div class="cp-cache-heatmap__grid">${cells.join('')}</div>
      </div>
    </div>
  `;

  // 图例渲染到标题行右侧（独立容器，避免宽设备下右下角空旷）
  const legendEl = container.querySelector('#cp-cache-heatmap-legend');
  if (legendEl) {
    legendEl.innerHTML = `
      <div class="cp-cache-heatmap__legend">
        <span>少</span>
        <div class="cp-cache-heatmap__cell cp-cache-heatmap__cell--empty"></div>
        <div class="cp-cache-heatmap__cell cp-cache-heatmap__cell--l1"></div>
        <div class="cp-cache-heatmap__cell cp-cache-heatmap__cell--l2"></div>
        <div class="cp-cache-heatmap__cell cp-cache-heatmap__cell--l3"></div>
        <div class="cp-cache-heatmap__cell cp-cache-heatmap__cell--l4"></div>
        <span>多</span>
      </div>
    `;
  }
}

// ============ 最近消息缓存明细 ============

function renderMessageList(container, convId) {
  const section = container.querySelector('#cp-cache-messages-section');
  if (!section) return;

  if (!convId || !currentConvStats || !currentConvStats.messages?.length) {
    return; // 无数据时不渲染该区块
  }

  // 从当前缓存链起点（最近一次未命中之后）开始累计，往最新方向递增
  // 最新命中累计最多（复用了前面所有连续命中的上下文），缓存链起点累计最少（仅自身）
  // 遇到未命中 AI 时缓存链断裂，累计重置为 0
  const sortedByTime = [...currentConvStats.messages].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  let cumulative = 0;
  const cumulativeSaved = new Map();
  for (const m of sortedByTime) {
    if (m.role !== 'user') {
      if (m.cacheHit) {
        // AI 命中：累计 += 输入 + 输出
        cumulative += m.promptTokens + m.completionTokens;
      } else {
        // AI 未命中：缓存链断裂，累计重置
        cumulative = 0;
      }
    }
    // 用户消息不产生节省，沿用当前累计值
    cumulativeSaved.set(m.id, cumulative);
  }

  const messages = currentConvStats.messages.slice(0, 15);

  section.innerHTML = `
    <h3 class="cp-section__title">最近消息缓存明细（前 ${messages.length} 条）</h3>
    <div id="cp-cache-msg-list"></div>
  `;

  const list = section.querySelector('#cp-cache-msg-list');
  list.innerHTML = messages
    .map((m) => {
      const roleLabel = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : '系统';
      // 用户消息的 cacheHit 关联到它触发的 AI 回复命中状态（用户输入作为上下文参与缓存命中判定）
      const hitBadge = m.cacheHit
        ? '<span class="cp-badge cp-badge--success">命中</span>'
        : '<span class="cp-badge cp-badge--error">未命中</span>';
      // 节省 = 前面所有命中缓存的(输入+输出)累加（累计值），反映到该消息为止累计节省的 token
      const saved = cumulativeSaved.get(m.id) || 0;
      return `
      <div class="cp-cache-msg-item">
        <div class="cp-cache-msg-item__role">${escapeHtml(roleLabel)}</div>
        <div class="cp-cache-msg-item__meta">
          ${hitBadge}
          <span>输入 ${formatK(m.promptTokens)}</span>
          <span>输出 ${formatK(m.completionTokens)}</span>
          <span>节省 ${formatK(saved)}</span>
        </div>
        <div class="cp-cache-msg-item__time">${escapeHtml(formatRelativeTime(m.timestamp))}</div>
      </div>`;
    })
    .join('');
}

// ============ 实时刷新：监听流式完成事件 ============

const debouncedRefresh = debounce(() => {
  const container = document.getElementById('cp-content-cache');
  if (!container || !container.children.length) return; // tab 未渲染则跳过
  // 仅当当前对话与事件一致时刷新（避免切换对话后误刷）
  renderCache(container, { force: true }).catch(() => {});
}, 800);

function bindStreamDoneListener() {
  if (streamDoneListenerBound) return;
  streamDoneListenerBound = true;
  document.addEventListener('chat:stream-done', (e) => {
    const detail = e.detail || {};
    const currentId = getConvId();
    if (detail.conversationId && detail.conversationId === currentId) {
      debouncedRefresh();
    }
  });
}
