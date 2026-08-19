/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import { Logger } from '@115master/shared'

const logger = new Logger('ED2KMD4')
const ROUND2 = 0x5A827999
const ROUND3 = 0x6ED9EBA1

function rotate(value: number, bits: number) {
  return (value << bits) | (value >>> (32 - bits))
}

function choose(x: number, y: number, z: number) {
  return (x & y) | (~x & z)
}

function majority(x: number, y: number, z: number) {
  return (x & y) | (x & z) | (y & z)
}

function parity(x: number, y: number, z: number) {
  return x ^ y ^ z
}

function read(data: Uint8Array, offset: number, words: Int32Array) {
  for (let index = 0; index < 16; index++) {
    const start = offset + index * 4
    words[index] = data[start]!
      | (data[start + 1]! << 8)
      | (data[start + 2]! << 16)
      | (data[start + 3]! << 24)
  }
}

function transform(state: Int32Array, words: Int32Array) {
  let a = state[0]!
  let b = state[1]!
  let c = state[2]!
  let d = state[3]!

  for (let index = 0; index < 16; index += 4) {
    a = rotate((a + choose(b, c, d) + words[index]!) | 0, 3)
    d = rotate((d + choose(a, b, c) + words[index + 1]!) | 0, 7)
    c = rotate((c + choose(d, a, b) + words[index + 2]!) | 0, 11)
    b = rotate((b + choose(c, d, a) + words[index + 3]!) | 0, 19)
  }

  for (let index = 0; index < 4; index++) {
    a = rotate((a + majority(b, c, d) + words[index]! + ROUND2) | 0, 3)
    d = rotate((d + majority(a, b, c) + words[index + 4]! + ROUND2) | 0, 5)
    c = rotate((c + majority(d, a, b) + words[index + 8]! + ROUND2) | 0, 9)
    b = rotate((b + majority(c, d, a) + words[index + 12]! + ROUND2) | 0, 13)
  }

  for (const index of [0, 2, 1, 3]) {
    a = rotate((a + parity(b, c, d) + words[index]! + ROUND3) | 0, 3)
    d = rotate((d + parity(a, b, c) + words[index + 8]! + ROUND3) | 0, 9)
    c = rotate((c + parity(d, a, b) + words[index + 4]! + ROUND3) | 0, 11)
    b = rotate((b + parity(c, d, a) + words[index + 12]! + ROUND3) | 0, 15)
  }

  state[0] = (state[0]! + a) | 0
  state[1] = (state[1]! + b) | 0
  state[2] = (state[2]! + c) | 0
  state[3] = (state[3]! + d) | 0
}

function write(value: number, output: Uint8Array, offset: number) {
  output[offset] = value
  output[offset + 1] = value >>> 8
  output[offset + 2] = value >>> 16
  output[offset + 3] = value >>> 24
}

/**
 * ============================================================================
 * 步骤1：用纯 TypeScript 计算 MD4
 * ============================================================================
 * 目标：在禁止 WebAssembly unsafe-eval 的 115 页面中计算标准 MD4。
 * 数据源：单个 ED2K 文件分块或分块摘要字节串。
 * 操作：
 * 1) 按 RFC 1320 处理 64 字节数据块
 * 2) 追加长度填充并输出小端序摘要
 */
export function md4(data: Uint8Array) {
  logger.info('开始计算纯 TypeScript MD4', data.byteLength)

  // 1.1 复用固定状态与消息字数组，避免按 64 字节数据块分配对象
  const state = new Int32Array([
    0x67452301,
    0xEFCDAB89,
    0x98BADCFE,
    0x10325476,
  ])
  const words = new Int32Array(16)
  let offset = 0
  while (offset + 64 <= data.byteLength) {
    read(data, offset, words)
    transform(state, words)
    offset += 64
  }

  // 1.2 尾部最多使用两个数据块，并以小端序写入 64 位比特长度
  const remainder = data.byteLength - offset
  const tail = new Uint8Array(remainder < 56 ? 64 : 128)
  tail.set(data.subarray(offset))
  tail[remainder] = 0x80
  write((data.byteLength * 8) >>> 0, tail, tail.byteLength - 8)
  write(Math.floor(data.byteLength / 0x20000000), tail, tail.byteLength - 4)

  for (let tailOffset = 0; tailOffset < tail.byteLength; tailOffset += 64) {
    read(tail, tailOffset, words)
    transform(state, words)
  }

  // 1.3 MD4 的四个状态字按小端序组成 16 字节大写摘要
  const digest = new Uint8Array(16)
  state.forEach((value, index) => write(value, digest, index * 4))
  const hash = Array.from(
    digest,
    value => value.toString(16).padStart(2, '0'),
  ).join('').toUpperCase()

  logger.info('纯 TypeScript MD4 计算完成', data.byteLength)
  return hash
}
