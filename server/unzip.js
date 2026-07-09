// ===================================================================
// 零依赖 ZIP 解析器 —— 仅用 Node 内置 node:zlib（inflateRawSync）。
//   项目坚持「零 npm 运行时依赖」，故不引入 yauzl/adm-zip 等库，
//   自行解析 ZIP 容器（End of Central Directory → Central Directory →
//   Local File Header），对每个条目按压缩方法解压：
//     method 0 (stored)  → 直接切片
//     method 8 (deflate) → zlib.inflateRawSync
//   其余方法（如 bzip2/lzma）不支持，跳过并记录。
//
// 安全：仅解析、返回 { path, data } 列表；不落盘、不解析文件名成磁盘路径。
//   由调用方负责 Zip Slip 防护（normalize+去 ..）、随机命名、体积上限。
// ===================================================================
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;   // End of Central Directory
const CDH_SIG  = 0x02014b50;   // Central Directory File Header
const LFH_SIG  = 0x04034b50;   // Local File Header

// 在缓冲区尾部回扫 EOCD（注释可达 64KB，故最多回扫 64K+22 字节）。
function findEOCD(buf) {
  const min = 22;
  if (buf.length < min) return -1;
  const maxBack = Math.min(buf.length, 22 + 0xffff);
  for (let i = buf.length - min; i >= buf.length - maxBack; i--) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

// ZIP 里文件名默认 UTF-8（bit 11 置位）或 CP437；这里统一按 UTF-8 解，
// 对中文目录（本项目导出包场景）最稳妥。
function decodeName(buf) {
  return buf.toString("utf8");
}

/**
 * 解析 ZIP 缓冲区，返回条目数组。
 * @param {Buffer} buf 完整 zip 字节
 * @param {object} [opts]
 * @param {number} [opts.maxEntrySize] 单条目解压后上限（防 zip bomb），默认 200MB
 * @param {number} [opts.maxTotalSize] 全部条目解压后总上限，默认 500MB
 * @returns {{ entries: Array<{path:string,data:Buffer}>, skipped: Array<{path:string,reason:string}> }}
 */
export function unzip(buf, { maxEntrySize = 200 * 1024 * 1024, maxTotalSize = 500 * 1024 * 1024 } = {}) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error("不是有效的 ZIP 文件（未找到 EOCD 记录）");

  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset >= buf.length) throw new Error("ZIP 中央目录偏移越界，文件可能损坏");

  const entries = [];
  const skipped = [];
  let total = 0;
  let p = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) break;
    const method   = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncSize  = buf.readUInt32LE(p + 24);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    const lfhOff   = buf.readUInt32LE(p + 42);
    const name     = decodeName(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;

    // 目录条目（以 / 结尾）直接跳过。
    if (name.endsWith("/")) continue;
    if (uncSize > maxEntrySize) { skipped.push({ path: name, reason: `单文件超过 ${Math.round(maxEntrySize / 1024 / 1024)}MB` }); continue; }

    // 从本地文件头定位实际数据起点（LFH 的 name/extra 长度可能与 CDH 不同）。
    if (lfhOff + 30 > buf.length || buf.readUInt32LE(lfhOff) !== LFH_SIG) {
      skipped.push({ path: name, reason: "本地文件头无效" }); continue;
    }
    const lNameLen  = buf.readUInt16LE(lfhOff + 26);
    const lExtraLen = buf.readUInt16LE(lfhOff + 28);
    const dataStart = lfhOff + 30 + lNameLen + lExtraLen;
    const compData  = buf.subarray(dataStart, dataStart + compSize);

    let data;
    try {
      if (method === 0) data = Buffer.from(compData);           // stored
      else if (method === 8) data = inflateRawSync(compData);   // deflate
      else { skipped.push({ path: name, reason: `不支持的压缩方法 ${method}` }); continue; }
    } catch (e) {
      skipped.push({ path: name, reason: `解压失败：${e.message}` }); continue;
    }

    total += data.length;
    if (total > maxTotalSize) throw new Error(`解压总大小超过 ${Math.round(maxTotalSize / 1024 / 1024)}MB，疑似 zip bomb，已中止`);
    entries.push({ path: name, data });
  }

  return { entries, skipped };
}
