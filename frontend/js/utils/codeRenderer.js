/**
 * 代码渲染器模块
 * 功能：
 * 1. HTML 渲染器 - 检测前端代码块，用 iframe 实时渲染为可视化界面
 *    内置第三方库环境（Tailwind CSS / Vue 3 / jQuery / Font Awesome）
 * 2. 代码折叠 - 为代码块添加折叠/展开按钮
 *
 * 参考: JS-Slash-Runner 插件 (https://github.com/N0VI028/JS-Slash-Runner)
 */

// 本地第三方库路径（避免 CDN 被浏览器跟踪防护拦截）
const LIB_BASE = '/lib/renderer';

// 全局 resize 监听：通知所有渲染 iframe 更新 viewport 高度
let _resizeListenerAdded = false;
function ensureResizeListener() {
  if (_resizeListenerAdded) return;
  _resizeListenerAdded = true;
  window.addEventListener('resize', () => {
    document.querySelectorAll('.st-render-iframe').forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage({ type: 'ST_UPDATE_VIEWPORT' }, '*');
      } catch (e) { /* ignore */ }
    });
  });
}

/**
 * 检测代码是否为前端代码（包含 html>、<head>、<body 任一标签）
 */
export function isFrontendCode(text) {
  if (!text) return false;
  return ['html>', '<head>', '<body'].some((tag) => text.includes(tag));
}

/**
 * 处理代码中的 vh 单位，替换为 CSS 变量（与 JS-Slash-Runner 一致）
 * iframe 内 100vh 不等于可见区域高度，需用父窗口实际高度替代
 */
function replaceVhInContent(content) {
  const hasVh = /\d+(?:\.\d+)?vh/gi.test(content);
  if (!hasVh) return content;

  const VAR = 'var(--st-viewport-height, 100vh)';
  // CSS 中的 min-height: Nvh
  content = content.replace(
    /(min-height\s*:\s*)([^;{}]*?\d+(?:\.\d+)?vh)(?=\s*[;}])/gi,
    (_m, prefix, value) => {
      const converted = value.replace(/(\d+(?:\.\d+)?)vh\b/gi, (_m2, num) => {
        const n = parseFloat(num);
        if (!isFinite(n)) return _m2;
        return n === 100 ? VAR : `calc(${VAR} * ${n / 100})`;
      });
      return `${prefix}${converted}`;
    },
  );
  return content;
}

/**
 * 生成 iframe 完整 HTML 文档
 * 使用 base64 编码方案，彻底避免代码中反引号、${、</script> 等特殊字符的转义问题
 * @param {string} code - 前端代码
 * @param {object} [parentStyles] - 父级计算样式 { color, fontFamily, fontSize, lineHeight }
 */
export function createIframeContent(code, parentStyles) {
  const ps = parentStyles || {};
  code = replaceVhInContent(code);

  // 背景色：直接使用父级气泡的实际背景色，保证视觉融合
  const bg = ps.backgroundColor || 'transparent';

  // 构建内层样式
  const extraCss = [
    ps.color ? 'color:' + ps.color + ';' : '',
    ps.fontFamily ? 'font-family:' + ps.fontFamily + ';' : '',
    ps.fontSize ? 'font-size:' + ps.fontSize + ';' : '',
    ps.lineHeight ? 'line-height:' + ps.lineHeight + ';' : '',
  ].join('');

  // 构建完整内层 HTML 文档（使用字符串拼接，避免模板字符串转义问题）
  const innerDoc = '<!DOCTYPE html>\n'
    + '<html>\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<style>\n'
    + '*,*::before,*::after{box-sizing:border-box;}\n'
    + 'html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;'
    + 'background:' + bg + '!important;background-color:' + bg + '!important;' + extraCss + '}\n'
    + '</style>\n'
    + '<script src="' + LIB_BASE + '/tailwind.min.js"><\/script>\n'
    + '<script src="' + LIB_BASE + '/jquery.min.js"><\/script>\n'
    + '<script src="' + LIB_BASE + '/vue.global.prod.js"><\/script>\n'
    + '<style>\n'
    + 'html,body{background:' + bg + '!important;background-color:' + bg + '!important;}\n'
    + '</style>\n'
    + '<script>\n'
    + 'window._ = window._ || undefined;\n'
    + 'window.__ST_IFRAME_ID = (window.frameElement && window.frameElement.id) || window.name || "";\n'
    + 'window.ST = {\n'
    + '  fillInput: function(text) { window.parent.postMessage({ type: "ST_FILL_INPUT", text: String(text) }, "*"); },\n'
    + '  send: function(text) { window.parent.postMessage({ type: "ST_SEND", text: String(text) }, "*"); }\n'
    + '};\n'
    + 'window.SillyTavern = {\n'
    + '  getContext: function() { return window.SillyTavern; },\n'
    + '  executeSlashCommandsWithOptions: function(text) {\n'
    + '    var cmd = String(text).trim();\n'
    + '    var m;\n'
    + '    m = cmd.match(/^\\/setinput\\s+([\\s\\S]*)/i);\n'
    + '    if (m) { window.ST.fillInput(m[1].trim()); return Promise.resolve({ isError: false, pipe: m[1].trim() }); }\n'
    + '    m = cmd.match(/^\\/send\\s+([\\s\\S]*)/i);\n'
    + '    if (m) { window.ST.send(m[1].trim()); return Promise.resolve({ isError: false, pipe: m[1].trim() }); }\n'
    + '    m = cmd.match(/^\\/input\\s+([\\s\\S]*)/i);\n'
    + '    if (m) { window.ST.fillInput(m[1].trim()); return Promise.resolve({ isError: false, pipe: m[1].trim() }); }\n'
    + '    m = cmd.match(/^\\/echo\\s+([\\s\\S]*)/i);\n'
    + '    if (m) { return Promise.resolve({ isError: false, pipe: m[1].trim() }); }\n'
    + '    m = cmd.match(/^\\/trigger([\\s\\S]*)/i);\n'
    + '    if (m) { window.parent.postMessage({ type: "ST_TRIGGER" }, "*"); return Promise.resolve({ isError: false, pipe: "" }); }\n'
    + '    return Promise.resolve({ isError: false, pipe: "" });\n'
    + '  },\n'
    + '  send: function(text) { window.ST.send(text); },\n'
    + '  input: function(text) { window.ST.fillInput(text); }\n'
    + '};\n'
    + 'window.triggerSlash = function(command) {\n'
    + '  return window.SillyTavern.executeSlashCommandsWithOptions(command).then(function(result) {\n'
    + '    if (result.isError) throw new Error("Slash command error: " + command);\n'
    + '    return result.pipe || "";\n'
    + '  });\n'
    + '};\n'
    + '(function(){\n'
    + '  function setVH() {\n'
    + '    try { document.documentElement.style.setProperty("--st-viewport-height", window.parent.innerHeight + "px"); } catch(e) {}\n'
    + '  }\n'
    + '  setVH();\n'
    + '  window.addEventListener("message", function(e) { if (e.data && e.data.type === "ST_UPDATE_VIEWPORT") setVH(); });\n'
    + '  window.addEventListener("resize", setVH);\n'
    + '})();\n'
    + '<\/script>\n'
    + '</head>\n<body>\n'
    + code + '\n'
    + '<script>\n'
    + '(function(){\n'
    + '  var scheduled = false;\n'
    + '  function measure() {\n'
    + '    scheduled = false;\n'
    + '    try {\n'
    + '      var frame = window.frameElement;\n'
    + '      if (!frame) return;\n'
    + '      var body = document.body;\n'
    + '      var html = document.documentElement;\n'
    + '      if (!body || !html) return;\n'
    + '      frame.style.height = "0px";\n'
    + '      var height = Math.max(body.scrollHeight, body.offsetHeight, html.scrollHeight, html.offsetHeight);\n'
    + '      if (!Number.isFinite(height) || height <= 0) height = 20;\n'
    + '      frame.style.height = height + "px";\n'
    + '    } catch(e) {}\n'
    + '  }\n'
    + '  function postHeight() {\n'
    + '    if (scheduled) return;\n'
    + '    scheduled = true;\n'
    + '    if (typeof requestAnimationFrame === "function") { requestAnimationFrame(measure); }\n'
    + '    else { setTimeout(measure, 16); }\n'
    + '  }\n'
    + '  function observe() {\n'
    + '    var body = document.body;\n'
    + '    if (!body) return;\n'
    + '    if (typeof ResizeObserver !== "undefined") { new ResizeObserver(function() { postHeight(); }).observe(body); }\n'
    + '    if (typeof MutationObserver !== "undefined") { new MutationObserver(function() { postHeight(); }).observe(body, { childList: true, subtree: true, attributes: true }); }\n'
    + '  }\n'
    + '  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", function() { postHeight(); observe(); }); }\n'
    + '  else { postHeight(); observe(); }\n'
    + '  window.addEventListener("load", function() { postHeight(); });\n'
    + '  setTimeout(function() { postHeight(); }, 300);\n'
    + '  setTimeout(function() { postHeight(); }, 1000);\n'
    + '})();\n'
    + '<\/script>\n'
    + '</body>\n</html>';

  // Base64 编码（支持 Unicode）
  const encoded = btoa(
    Array.from(new TextEncoder().encode(innerDoc), (b) => String.fromCharCode(b)).join('')
  );

  // 外层 srcdoc：仅包含解码引导脚本（base64 字符不含任何 HTML/JS 特殊字符）
  return '<!DOCTYPE html><html><body style="margin:0">'
    + '<script>var d=atob("' + encoded + '");'
    + 'var b=new Uint8Array(d.length);'
    + 'for(var i=0;i<d.length;i++)b[i]=d.charCodeAt(i);'
    + 'document.write(new TextDecoder().decode(b));document.close();<\/script>'
    + '</body></html>';
}

/**
 * 对容器内所有代码块应用渲染/折叠
 * @param {HTMLElement} container - 消息容器
 * @param {object} settings - { renderEnabled, collapseCodeBlock }
 */
export function applyCodeRendering(container, settings) {
  if (!container) return;
  const { renderEnabled, collapseCodeBlock } = settings || {};
  const collapseMode = collapseCodeBlock || 'none';

  const preElements = container.querySelectorAll('pre');
  preElements.forEach((pre) => {
    // 跳过已处理的
    if (pre.closest('.st-render-wrap')) return;

    const codeEl = pre.querySelector('code');
    const codeText = codeEl ? codeEl.textContent : pre.textContent;
    const isFrontend = isFrontendCode(codeText);

    // 创建包裹容器
    const wrap = document.createElement('div');
    wrap.className = 'st-render-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    // 1. HTML 渲染器：前端代码 -> iframe 渲染
    if (renderEnabled && isFrontend) {
      ensureResizeListener();
      // 从最近的消息气泡读取实际计算样式，注入 iframe 使内容视觉一致
      const bubble = pre.closest('.message__bubble') || container;
      const computed = window.getComputedStyle(bubble);
      const parentStyles = {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        lineHeight: computed.lineHeight,
      };

      const iframe = document.createElement('iframe');
      iframe.className = 'st-render-iframe';
      iframe.setAttribute('loading', 'lazy');
      iframe.srcdoc = createIframeContent(codeText, parentStyles);
      wrap.appendChild(iframe);

      // 渲染成功时隐藏源码
      pre.style.display = 'none';
    }

    // 2. 代码折叠
    if (collapseMode !== 'none') {
      // "仅前端"模式下，非前端代码不折叠
      if (collapseMode === 'frontend_only' && !isFrontend) return;

      // 如果已被渲染器渲染（有 iframe），默认折叠源码
      const hasIframe = wrap.querySelector('.st-render-iframe');
      const label = isFrontend ? '前端代码块' : '代码块';

      const btn = document.createElement('div');
      btn.className = 'st-collapse-btn';
      btn.textContent = hasIframe ? `显示${label}` : `显示${label}`;
      btn.addEventListener('click', () => {
        const isHidden = pre.style.display === 'none';
        if (isHidden) {
          pre.style.display = '';
          btn.textContent = `隐藏${label}`;
        } else {
          pre.style.display = 'none';
          btn.textContent = `显示${label}`;
        }
      });

      // 按钮插入到 wrap 最前面
      wrap.insertBefore(btn, wrap.firstChild);

      // 默认折叠（隐藏 pre）
      if (!hasIframe) {
        pre.style.display = 'none';
      }
    }
  });
}

/**
 * 清理所有渲染产物（iframe、折叠按钮），恢复原始 pre 显示
 * 用于设置变更时重新渲染
 */
export function removeCodeRendering(container) {
  if (!container) return;

  // 移除所有 iframe
  container.querySelectorAll('.st-render-iframe').forEach((el) => el.remove());
  // 移除所有折叠按钮
  container.querySelectorAll('.st-collapse-btn').forEach((el) => el.remove());

  // 解包 .st-render-wrap，恢复 pre 到原始位置
  container.querySelectorAll('.st-render-wrap').forEach((wrap) => {
    const pre = wrap.querySelector('pre');
    if (pre) {
      pre.style.display = '';
      wrap.parentNode.insertBefore(pre, wrap);
    }
    wrap.remove();
  });
}
