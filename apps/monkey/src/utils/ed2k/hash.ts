/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import { Logger } from '@115master/shared'
import { createMD4 } from 'hash-wasm'

export const ED2K_PART_SIZE = 9_728_000
export const ED2K_EMPTY_HASH = '31D6CFE0D16AE931B73C59D7E0C089C0'

const logger = new Logger('ED2KHash')

function bytes(hash: string) {
  if (!/^[0-9A-F]{32}$/.test(hash))
    throw new Error('ED2K 分块摘要格式无效')

  return Uint8Array.from(
    hash.match(/.{2}/g) ?? [],
    value => Number.parseInt(value, 16),
  )
}

/**
 * ============================================================================
 * 步骤1：计算单个 ED2K 分块摘要
 * ============================================================================
 * 目标：对不超过 9,728,000 字节的数据计算标准 MD4。
 * 数据源：Range 请求返回的单个 ArrayBuffer。
 * 操作：
 * 1) 初始化独立 MD4 状态
 * 2) 输出大写十六进制摘要
 */
export async function hashEd2kPart(data: Uint8Array) {
  logger.info('开始计算 ED2K 分块摘要', data.byteLength)

  // 1.1 初始化并写入当前分块
  const md4 = await createMD4()
  md4.init().update(data)

  // 1.2 固化摘要，避免后续复用状态污染结果
  const hash = (md4.digest('hex') as string).toUpperCase()
  logger.info('ED2K 分块摘要计算完成', data.byteLength)
  return hash
}

/**
 * ============================================================================
 * 步骤2：汇总 ED2K 文件摘要
 * ============================================================================
 * 目标：按 eDonkey2000 规则把分块摘要汇总为文件摘要。
 * 数据源：顺序分块摘要和服务端声明的完整文件大小。
 * 操作：
 * 1) 校验分块数量
 * 2) 整分块文件追加空分块摘要
 * 3) 对摘要字节串再次计算 MD4
 */
export async function finishEd2kHash(parts: string[], size: number) {
  logger.info('开始汇总 ED2K 文件摘要', size, parts.length)

  // 2.1 空文件使用 MD4 空摘要；普通小文件直接使用唯一分块摘要
  if (size === 0) {
    logger.info('ED2K 文件摘要汇总完成，空文件')
    return ED2K_EMPTY_HASH
  }

  const count = Math.ceil(size / ED2K_PART_SIZE)
  if (parts.length !== count)
    throw new Error(`ED2K 分块数量不匹配：预期 ${count}，实际 ${parts.length}`)

  if (size < ED2K_PART_SIZE) {
    logger.info('ED2K 文件摘要汇总完成，单分块')
    return parts[0]!
  }

  // 2.2 协议要求整分块文件在摘要集合末尾追加 MD4 空摘要
  const hashes = size % ED2K_PART_SIZE === 0
    ? [...parts, ED2K_EMPTY_HASH]
    : parts
  const data = new Uint8Array(hashes.length * 16)
  hashes.forEach((hash, index) => data.set(bytes(hash), index * 16))

  // 2.3 对分块摘要字节串计算最终 MD4
  const hash = await hashEd2kPart(data)
  logger.info('ED2K 文件摘要汇总完成', size, hashes.length)
  return hash
}

/**
 * ============================================================================
 * 步骤3：生成标准 ED2K 链
 * ============================================================================
 * 目标：组合客户端可识别的 file 链接。
 * 数据源：115 文件名、文件大小和 ED2K 文件摘要。
 * 操作：
 * 1) 替换协议分隔符和换行
 * 2) 拼接标准 ed2k://|file|...|/ 结构
 */
export function buildEd2kLink(name: string, size: number, hash: string) {
  logger.info('开始生成 ED2K 链', name, size)

  // 3.1 只替换会破坏链接结构的字符，保留中文、日文和空格
  const safe = name.replace(/[|\r\n]/g, '_')
  if (!safe)
    throw new Error('文件名不能为空')
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error('文件大小无效')
  if (!/^[0-9A-F]{32}$/.test(hash))
    throw new Error('ED2K 文件摘要格式无效')

  // 3.2 生成不附带来源和 AICH 的标准文件链接
  const link = `ed2k://|file|${safe}|${size}|${hash}|/`
  logger.info('ED2K 链生成完成', name, size)
  return link
}
