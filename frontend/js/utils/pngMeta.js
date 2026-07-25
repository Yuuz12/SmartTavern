/**
 * PNG 元数据工具
 * 用于在 PNG 文件的 tEXt chunk 中嵌入/提取角色卡数据
 * 兼容 SillyTavern 的 PNG 角色卡格式（keyword: "chara", value: base64 JSON）
 */

// PNG 签名（8 字节）
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * CRC32 计算（PNG chunk 校验）
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 解析 PNG 的所有 chunks
 * @param {ArrayBuffer} buffer
 * @returns {{ type: string, data: Uint8Array, offset: number }[]}
 */
function parseChunks(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  let offset = 8; // 跳过 PNG 签名

  while (offset < buffer.byteLength) {
    const length = view.getUint32(offset);
    const typeBytes = bytes.slice(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.slice(offset + 8, offset + 8 + length);
    chunks.push({ type, data, offset });
    offset += 12 + length; // 4(length) + 4(type) + data + 4(crc)
  }

  return chunks;
}

/**
 * 构建一个 tEXt chunk 的二进制数据
 * @param {string} keyword
 * @param {string} text
 * @returns {Uint8Array} 完整的 chunk（含 length + type + data + crc）
 */
function buildTextChunk(keyword, text) {
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(text);

  // chunk data = keyword + null separator + text
  const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData[keywordBytes.length] = 0; // null separator
  chunkData.set(textBytes, keywordBytes.length + 1);

  // type = "tEXt"
  const typeBytes = new Uint8Array([116, 69, 88, 116]); // tEXt

  // length (4 bytes, big-endian)
  const length = chunkData.length;
  const result = new Uint8Array(4 + 4 + length + 4);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, length);
  result.set(typeBytes, 4);
  result.set(chunkData, 8);

  // CRC over type + data
  const crcInput = new Uint8Array(4 + length);
  crcInput.set(typeBytes, 0);
  crcInput.set(chunkData, 4);
  resultView.setUint32(8 + length, crc32(crcInput));

  return result;
}

/**
 * 在 PNG 的 IHDR 之后插入 tEXt chunk
 * @param {ArrayBuffer} pngBuffer - 原始 PNG 二进制
 * @param {string} keyword - tEXt keyword（如 "chara"）
 * @param {string} text - 要嵌入的文本
 * @returns {ArrayBuffer} 新的 PNG 二进制
 */
export function insertTextChunk(pngBuffer, keyword, text) {
  const signature = new Uint8Array(pngBuffer, 0, 8);
  const chunks = parseChunks(pngBuffer);

  // 找到 IHDR 的位置（通常是第一个 chunk）
  const ihdrIndex = chunks.findIndex((c) => c.type === 'IHDR');
  if (ihdrIndex === -1) throw new Error('无效的 PNG 文件：未找到 IHDR');

  // 移除已有的同 keyword 的 tEXt chunk
  const filteredChunks = chunks.filter((c) => {
    if (c.type !== 'tEXt') return true;
    const nullIdx = c.data.indexOf(0);
    if (nullIdx === -1) return true;
    const kw = String.fromCharCode(...c.data.slice(0, nullIdx));
    return kw !== keyword;
  });

  // 构建新的 tEXt chunk
  const newChunk = buildTextChunk(keyword, text);

  // 拼接：signature + IHDR + newChunk + 其余 chunks
  const parts = [signature];

  for (let i = 0; i < filteredChunks.length; i++) {
    const chunk = filteredChunks[i];
    // 从原始 buffer 中取出完整 chunk 数据
    const view = new DataView(pngBuffer);
    const chunkLength = view.getUint32(chunk.offset);
    const fullChunk = new Uint8Array(pngBuffer, chunk.offset, 12 + chunkLength);
    parts.push(fullChunk);

    // 在 IHDR 之后插入新 chunk
    if (i === ihdrIndex) {
      parts.push(newChunk);
    }
  }

  // 合并所有部分
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result.buffer;
}

/**
 * 从 PNG 中提取指定 keyword 的 tEXt chunk 内容
 * @param {ArrayBuffer} pngBuffer
 * @param {string} keyword
 * @returns {string|null}
 */
export function extractTextChunk(pngBuffer, keyword) {
  const chunks = parseChunks(pngBuffer);

  for (const chunk of chunks) {
    if (chunk.type !== 'tEXt') continue;
    const nullIdx = chunk.data.indexOf(0);
    if (nullIdx === -1) continue;
    const kw = String.fromCharCode(...chunk.data.slice(0, nullIdx));
    if (kw === keyword) {
      const decoder = new TextDecoder();
      return decoder.decode(chunk.data.slice(nullIdx + 1));
    }
  }

  return null;
}

/**
 * 生成纯色占位 PNG（使用 Canvas）
 * @param {number} width
 * @param {number} height
 * @param {string} color - CSS 颜色值
 * @returns {Promise<ArrayBuffer>}
 */
export async function createPlaceholderPng(width = 400, height = 400, color = '#6750A4') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas toBlob 失败'));
          return;
        }
        blob.arrayBuffer().then(resolve).catch(reject);
      },
      'image/png',
    );
  });
}

/**
 * 将字符串编码为 base64（支持 Unicode）
 */
export function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 将 base64 解码为字符串（支持 Unicode）
 */
export function decodeBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * 验证是否为有效的 PNG 文件
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
export function isValidPng(buffer) {
  if (buffer.byteLength < 8) return false;
  const bytes = new Uint8Array(buffer, 0, 8);
  return PNG_SIGNATURE.every((v, i) => bytes[i] === v);
}
