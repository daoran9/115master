import { unzipSync } from 'fflate'
import { matchesAvNumber } from './av.ts'

/* eslint-disable jsdoc/convert-to-jsdoc-comments */

const SUBTITLE_EXTENSIONS = new Set(['ass', 'srt', 'ssa', 'vtt'])

const logger = {
  info: (...args: unknown[]) => console.info('[115Master:SubtitleArchive]', ...args),
  warn: (...args: unknown[]) => console.warn('[115Master:SubtitleArchive]', ...args),
}

export interface SubtitlePayload {
  format: string
  name: string
  raw: Blob
}

function getExtension(value: string): string {
  const match = value.split(/[?#]/)[0]?.match(/\.([a-z0-9]+)$/i)
  return match?.[1]?.toLowerCase() ?? ''
}

function getType(format: string): string {
  if (format === 'vtt')
    return 'text/vtt'
  if (format === 'ass' || format === 'ssa')
    return 'text/x-ssa'
  return 'application/x-subrip'
}

/** 从 Content-Disposition 读取服务端声明的文件名。 */
export function getResponseFileName(response: Response): string {
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^['"]|['"]$/g, ''))
    }
    catch {
      return encoded
    }
  }
  return disposition.match(/filename=["']?([^;"']+)/i)?.[1]?.trim() ?? ''
}

function scoreEntry(
  name: string,
  bytes: Uint8Array,
  avNumber: string,
  extract: (value: string) => null | string,
): number {
  const candidate = extract(name)
  if (candidate && !matchesAvNumber(name, avNumber, extract))
    return Number.NEGATIVE_INFINITY
  const exact = candidate ? 1000 : 0
  const language = /(?:^|[._\s-])(?:zh|zh-cn|chs|sc|简体|中文)(?:[._\s-]|$)/i.test(name) ? 100 : 0
  const noise = /sample|preview|trailer|readme|说明|广告/i.test(name) ? -500 : 0
  return exact + language + noise + Math.min(99, Math.floor(bytes.byteLength / 1024))
}

/** 把直链或 ZIP 响应转换成播放器可读取的单个字幕。 */
export async function extractSubtitlePayload(
  raw: Blob,
  name: string,
  contentType: string,
  avNumber: string,
  extract: (value: string) => null | string,
): Promise<SubtitlePayload | undefined> {
  /*
   * ================================================================================
   * 步骤3：整理字幕下载结果
   * ================================================================================
   * 目标：直链字幕直接返回，ZIP 包选择与当前番号最相关的字幕文件。
   * 数据源：下载字节、响应文件名、内容类型和目标番号。
   * 操作：
   * 1) 判断直链或 ZIP
   * 2) ZIP 内过滤格式、冲突番号和噪声文件
   */
  logger.info('开始整理字幕下载结果', name, contentType)

  // 3.1 支持浏览器播放器可解析的直链字幕格式。
  const format = getExtension(name)
  if (SUBTITLE_EXTENSIONS.has(format)) {
    const result = { format, name, raw: new Blob([await raw.arrayBuffer()], { type: getType(format) }) }
    logger.info('字幕下载结果整理完成，使用直链', name)
    return result
  }

  // 3.2 只解包 ZIP；其他压缩格式交给来源继续回退。
  const bytes = new Uint8Array(await raw.arrayBuffer())
  const zipped = format === 'zip'
    || /(?:application|multipart)\/(?:x-)?zip/i.test(contentType)
    || (bytes[0] === 0x50 && bytes[1] === 0x4B)
  if (!zipped) {
    logger.warn('字幕下载结果整理完成，不支持的文件格式', name)
    return undefined
  }

  // 3.3 解包后选择格式有效且没有冲突番号的最高分文件。
  const entries = Object.entries(unzipSync(bytes))
    .filter(([entry]) => SUBTITLE_EXTENSIONS.has(getExtension(entry)))
    .map(([entry, value]) => ({ entry, value, score: scoreEntry(entry, value, avNumber, extract) }))
    .filter(item => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score)
  const selected = entries[0]
  if (!selected) {
    logger.warn('字幕下载结果整理完成，ZIP 内没有可用字幕', name)
    return undefined
  }

  const selectedFormat = getExtension(selected.entry)
  const result = {
    format: selectedFormat,
    name: selected.entry,
    raw: new Blob([selected.value.slice().buffer], { type: getType(selectedFormat) }),
  }
  logger.info('字幕下载结果整理完成，使用 ZIP 文件', selected.entry)
  return result
}
