import type { ProcessedSubtitle } from '../cache.ts'
import type { AvSubtitleDeps } from '../types.ts'
import md5 from 'blueimp-md5'
import { extractSubtitlePayload, getResponseFileName } from './archive.ts'
import { buildAvSearchTerms, matchesAvNumber } from './av.ts'

/* eslint-disable jsdoc/convert-to-jsdoc-comments */

const BASE_URL = 'https://www.avsubtitles.com'

const logger = {
  info: (...args: unknown[]) => console.info('[115Master:AVSubtitles]', ...args),
  warn: (...args: unknown[]) => console.warn('[115Master:AVSubtitles]', ...args),
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function absolute(value: string, base = BASE_URL): string {
  return new URL(value, base).href
}

function languageCode(language: string): string {
  if (language === 'zh-CN' || language === 'zh-TW')
    return 'zh'
  if (language === 'en' || language === 'ja')
    return language
  return ''
}

/** AVSubtitles 搜索、会话下载和 ZIP 解包客户端。 */
export class AvSubtitles {
  private deps: AvSubtitleDeps

  constructor(deps: AvSubtitleDeps) {
    this.deps = deps
  }

  async fetchSubtitle(
    avNumber: string,
    language = 'zh-CN',
  ): Promise<ProcessedSubtitle[]> {
    /*
     * ================================================================================
     * 步骤1：查询 AVSubtitles
     * ================================================================================
     * 目标：只下载与当前番号完全一致的目标语言字幕。
     * 数据源：标准番号、站内搜索页、影片页和字幕下载页。
     * 操作：
     * 1) 用多个番号写法搜索并核对影片标题
     * 2) 读取目标语言字幕入口并完成会话下载
     */
    logger.info('开始查询 AVSubtitles', avNumber, language)

    // 1.1 不支持的语言或空番号直接返回。
    const code = languageCode(language)
    if (!avNumber || !code) {
      logger.info('AVSubtitles 查询完成，无有效参数')
      return []
    }

    // 1.2 依次尝试站内常用番号写法，首个精确影片结果即可。
    let movies: string[] = []
    for (const term of buildAvSearchTerms(avNumber)) {
      const url = `${BASE_URL}/search_results.php?search=${encodeURIComponent(term)}&category=jav&language=${encodeURIComponent(code)}`
      const response = await this.deps.request.get(url, { timeout: 16000 })
      if (!response.ok)
        continue
      movies = Array.from(parse(await response.text()).querySelectorAll<HTMLAnchorElement>('a[href]'))
        .filter(link => /\/movie\d+\//i.test(link.getAttribute('href') ?? ''))
        .filter(link => matchesAvNumber(link.textContent ?? '', avNumber, this.deps.extractAvNumber))
        .map(link => absolute(link.getAttribute('href') ?? ''))
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 3)
      if (movies.length)
        break
    }

    // 1.3 影片页只保留目标语言字幕入口。
    const links = (await Promise.all(movies.map(async (url) => {
      const response = await this.deps.request.get(url, { timeout: 16000 })
      if (!response.ok)
        return []
      return Array.from(parse(await response.text()).querySelectorAll<HTMLAnchorElement>(`a[href*="/subtitles/${code}/"]`))
        .map(link => absolute(link.getAttribute('href') ?? '', url))
    }))).flat().filter((value, index, values) => values.indexOf(value) === index).slice(0, 5)

    // 1.4 单条失败不影响同番号的其他字幕版本。
    const settled = await Promise.allSettled(
      links.map(url => this.download(url, avNumber, language)),
    )
    const results = settled
      .filter((result): result is PromiseFulfilledResult<ProcessedSubtitle | undefined> => result.status === 'fulfilled')
      .map(result => result.value)
      .filter((result): result is ProcessedSubtitle => Boolean(result))

    logger.info('AVSubtitles 查询完成', results.length)
    return results
  }

  private async download(
    detailUrl: string,
    avNumber: string,
    language: string,
  ): Promise<ProcessedSubtitle | undefined> {
    /*
     * ================================================================================
     * 步骤2：下载 AVSubtitles 字幕
     * ================================================================================
     * 目标：沿同一浏览器会话取得最终字幕文件并转成播放器格式。
     * 数据源：字幕详情页、下载中转页和最终文件响应。
     * 操作：
     * 1) 读取 subid/revid
     * 2) 打开下载页并解包最终文件
     */
    logger.info('开始下载 AVSubtitles 字幕', detailUrl)

    // 2.1 详情页提供下载中转页需要的两个参数。
    const detailResponse = await this.deps.request.get(detailUrl, { timeout: 16000 })
    if (!detailResponse.ok)
      return undefined
    const detail = parse(await detailResponse.text())
    const subId = detail.querySelector<HTMLInputElement>('input[name="subid"]')?.value
    const revId = detail.querySelector<HTMLInputElement>('input[name="revid"]')?.value
    const declaredName = detail.querySelector<HTMLElement>('.text-mono')?.textContent?.trim() ?? ''
    if (!subId || !revId)
      return undefined

    // 2.2 下载页提供带当前会话签名的最终地址。
    const pageUrl = `${BASE_URL}/download_page.php?subid=${encodeURIComponent(subId)}&revid=${encodeURIComponent(revId)}`
    const pageResponse = await this.deps.request.get(pageUrl, { timeout: 16000 })
    if (!pageResponse.ok)
      return undefined
    const href = parse(await pageResponse.text()).querySelector<HTMLAnchorElement>('a[href*="download_sub.php"]')?.getAttribute('href')
    if (!href)
      return undefined

    // 2.3 最终响应可能是直链字幕或 ZIP，统一整理成单个播放器字幕。
    const downloadUrl = absolute(href, pageUrl)
    const response = await this.deps.request.get(downloadUrl, { responseType: 'blob', timeout: 20000 })
    if (!response.ok)
      return undefined
    const payload = await extractSubtitlePayload(
      await response.blob(),
      getResponseFileName(response) || declaredName || `${avNumber}.zip`,
      response.headers.get('content-type') ?? '',
      avNumber,
      this.deps.extractAvNumber,
    )
    if (!payload)
      return undefined

    const result: ProcessedSubtitle = {
      id: md5(`avsubtitles:${detailUrl}:${payload.name}`),
      raw: payload.raw,
      format: payload.format,
      title: payload.name || avNumber,
      downloads: 0,
      comment: 0,
      originLanguage: language,
      targetLanguage: language,
      source: 'AVSubtitles',
      avNumber,
    }
    logger.info('AVSubtitles 字幕下载完成', result.title)
    return result
  }
}
