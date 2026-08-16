import type { ProcessedSubtitle } from '../cache.ts'
import type { AvSubtitleDeps } from '../types.ts'
import md5 from 'blueimp-md5'
import { extractSubtitlePayload, getResponseFileName } from './archive.ts'
import { buildAvSearchTerms, matchesAvNumber } from './av.ts'

/* eslint-disable jsdoc/convert-to-jsdoc-comments */

const BASE_URL = 'https://www.aiyi1.com'

const logger = {
  info: (...args: unknown[]) => console.info('[115Master:Aiyi]', ...args),
  warn: (...args: unknown[]) => console.warn('[115Master:Aiyi]', ...args),
}

interface SearchItem {
  title?: string
  url?: string
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function absolute(value: string, base = BASE_URL): string {
  return new URL(value, base).href
}

/** 爱译网番号字幕搜索与下载客户端。 */
export class Aiyi {
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
     * 步骤1：查询爱译网
     * ================================================================================
     * 目标：从 API 或 HTML 搜索页找到精确番号文章并下载中文字幕。
     * 数据源：标准番号、WordPress 搜索接口和文章详情页。
     * 操作：
     * 1) API 优先，失败后回退 HTML 搜索
     * 2) 精确核对番号后下载字幕直链
     */
    logger.info('开始查询爱译网', avNumber, language)

    // 1.1 爱译网只进入中文字幕链路。
    if (!avNumber || (language !== 'zh-CN' && language !== 'zh-TW')) {
      logger.info('爱译网查询完成，无有效参数')
      return []
    }

    // 1.2 API 搜索失败或无结果时继续使用 HTML 搜索页。
    let posts: string[] = []
    for (const term of buildAvSearchTerms(avNumber)) {
      try {
        const url = new URL('/wp-json/wp/v2/search', BASE_URL)
        url.searchParams.set('search', term)
        url.searchParams.set('per_page', '8')
        url.searchParams.set('type', 'post')
        url.searchParams.set('subtype', 'post')
        const response = await this.deps.request.get(url.href, { timeout: 12000 })
        const items = response.ok ? await response.json() as SearchItem[] : []
        posts = (Array.isArray(items) ? items : [])
          .filter(item => item.url && matchesAvNumber(`${item.title ?? ''} ${item.url}`, avNumber, this.deps.extractAvNumber))
          .map(item => absolute(item.url ?? ''))
        if (posts.length)
          break
      }
      catch (error) {
        logger.warn('爱译网 API 搜索失败', error)
      }
    }

    // 1.3 HTML 回退仍只接受能提取出精确番号的文章。
    if (!posts.length) {
      for (const term of buildAvSearchTerms(avNumber)) {
        const response = await this.deps.request.get(`${BASE_URL}/?s=${encodeURIComponent(term)}`, { timeout: 12000 })
        if (!response.ok)
          continue
        posts = Array.from(parse(await response.text()).querySelectorAll<HTMLAnchorElement>('a[href]'))
          .filter(link => /\/\d+\.html(?:$|[?#])/i.test(link.getAttribute('href') ?? ''))
          .filter(link => matchesAvNumber(`${link.textContent ?? ''} ${link.getAttribute('href') ?? ''}`, avNumber, this.deps.extractAvNumber))
          .map(link => absolute(link.getAttribute('href') ?? ''))
          .filter((value, index, values) => values.indexOf(value) === index)
          .slice(0, 8)
        if (posts.length)
          break
      }
    }

    // 1.4 单条文章下载失败时保留其他版本。
    const settled = await Promise.allSettled(
      posts.slice(0, 8).map(url => this.download(url, avNumber, language)),
    )
    const results = settled
      .filter((result): result is PromiseFulfilledResult<ProcessedSubtitle | undefined> => result.status === 'fulfilled')
      .map(result => result.value)
      .filter((result): result is ProcessedSubtitle => Boolean(result))

    logger.info('爱译网查询完成', results.length)
    return results
  }

  private async download(
    detailUrl: string,
    avNumber: string,
    language: string,
  ): Promise<ProcessedSubtitle | undefined> {
    /*
     * ================================================================================
     * 步骤2：下载爱译网字幕
     * ================================================================================
     * 目标：从精确番号文章中取得直链或 ZIP 字幕。
     * 数据源：文章详情页和字幕文件响应。
     * 操作：
     * 1) 提取受支持字幕链接
     * 2) 下载并整理成播放器字幕
     */
    logger.info('开始下载爱译网字幕', detailUrl)

    // 2.1 文章详情必须包含可直接请求的字幕或 ZIP 地址。
    const detailResponse = await this.deps.request.get(detailUrl, { timeout: 12000 })
    if (!detailResponse.ok)
      return undefined
    const document = parse(await detailResponse.text())
    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .find(item => /\.(?:ass|srt|ssa|vtt|zip)(?:$|[?#])/i.test(item.getAttribute('href') ?? ''))
    const href = link?.getAttribute('href')
    if (!href)
      return undefined

    // 2.2 下载文件并处理直链或 ZIP。
    const url = absolute(href, detailUrl)
    const response = await this.deps.request.get(url, { responseType: 'blob', timeout: 20000 })
    if (!response.ok)
      return undefined
    const payload = await extractSubtitlePayload(
      await response.blob(),
      getResponseFileName(response) || new URL(url).pathname.split('/').pop() || `${avNumber}.srt`,
      response.headers.get('content-type') ?? '',
      avNumber,
      this.deps.extractAvNumber,
    )
    if (!payload)
      return undefined

    const result: ProcessedSubtitle = {
      id: md5(`aiyi:${detailUrl}:${payload.name}`),
      raw: payload.raw,
      format: payload.format,
      title: payload.name || avNumber,
      downloads: 0,
      comment: 0,
      originLanguage: 'zh-CN',
      targetLanguage: language,
      source: '爱译网',
      avNumber,
    }
    logger.info('爱译网字幕下载完成', result.title)
    return result
  }
}
