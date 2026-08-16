import type { JavInfo } from './jav'
import dayjs from 'dayjs'
import { appLogger } from '@/utils/logger'
import { isSameAvNumber, Jav, JAV_SOURCE, normalizeAvNumber } from './jav'
import { createJavLibraryWorkerRequest } from './javLibraryWorker'

const logger = appLogger.sub('JavLibrary')
const JAVLIBRARY_TOP_LEVEL_SITE = 'https://javlibrary.com'
const GM_TRANSPORT_HEDGE_DELAY_MS = 1200
const CLOUDFLARE_CHALLENGE_PATTERN
  = /cf-chl-widget|challenge-platform|正在进行安全验证|verify you are human|just a moment/i

interface JavLibraryTransport {
  promise: Promise<JavInfo | undefined>
  cancel: () => void
}

/** 延迟启动 GM 请求，让可用的第一方工作页保留优先机会。 */
function createDelayedTransport(
  start: (signal: AbortSignal) => Promise<JavInfo | undefined>,
  delay: number,
): JavLibraryTransport {
  let started = false
  let controller: AbortController | undefined
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined
  let resolvePromise = undefined as unknown as (info: JavInfo | undefined) => void
  const promise = new Promise<JavInfo | undefined>((resolve) => {
    resolvePromise = resolve
    timer = globalThis.setTimeout(() => {
      started = true
      timer = undefined
      controller = new AbortController()
      start(controller.signal).then(resolve, () => resolve(undefined))
    }, delay)
  })
  return {
    promise,
    cancel: () => {
      if (started) {
        controller?.abort()
        return
      }
      if (timer !== undefined)
        globalThis.clearTimeout(timer)
      timer = undefined
      resolvePromise(undefined)
    },
  }
}

/** 返回最先完成的精确番号传输结果；所有通道失败时返回空。 */
function firstExactTransport(
  expectedAvNumber: string,
  transports: JavLibraryTransport[],
): Promise<{ index: number, info: JavInfo } | undefined> {
  return new Promise((resolve) => {
    let pending = transports.length
    let settled = false
    transports.forEach((transport, index) => {
      transport.promise.then((info) => {
        if (settled)
          return
        if (info && isSameAvNumber(expectedAvNumber, info.avNumber)) {
          settled = true
          resolve({ index, info })
          return
        }
        pending -= 1
        if (pending === 0) {
          settled = true
          resolve(undefined)
        }
      }, () => {
        pending -= 1
        if (!settled && pending === 0) {
          settled = true
          resolve(undefined)
        }
      })
    })
  })
}

/** 从页面标题中提取带字母的番号，排除 JavLibrary 页面日期字段。 */
function extractAvNumber(text?: string): string | undefined {
  if (!text)
    return undefined

  const candidates = [
    ...(text.match(/\b[A-Z0-9]{2,}(?:[-_][A-Z0-9]+)+\b/gi) ?? []),
    ...(text.match(/\b[A-Z]{2,}\d{2,}\b/gi) ?? []),
  ]
  return candidates.find(candidate => /[A-Z]/i.test(candidate))
}

/** 读取 JavLibrary 页面标题，兼容新版页面隐藏 h3 的情况。 */
function readPageTitle(dom: Document): string | undefined {
  const title = dom.querySelector(
    '#video_title .post-title, #video_title h3, meta[property="og:title"]',
  )?.textContent?.trim()
  || dom.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
  || dom.title?.trim()

  return title
    ?.replace(/\s*-\s*JAVLibrary\s*$/i, '')
    .trim() || undefined
}

/**
 * JavLibrary 番号资料源。
 */
export class JavLibrary extends Jav {
  source = JAV_SOURCE.JAVLIBRARY
  baseUrl = 'https://www.javlibrary.com/cn/'
  detailUrl = ''
  searchUrl = ''
  private activeTransports = new Map<string, JavLibraryTransport[]>()

  /** 取消当前番号尚未完成的工作页和 GM 传输。 */
  cancelInfoRequest(avNumber: string) {
    const requestKey = normalizeAvNumber(avNumber)
    const transports = this.activeTransports.get(requestKey)
    if (!transports)
      return

    logger.info('开始取消 JavLibrary 番号资料传输', avNumber)
    transports.forEach(transport => transport.cancel())
    this.activeTransports.delete(requestKey)
    logger.info('JavLibrary 番号资料传输取消完成', avNumber)
  }

  async getInfoByAvNumber(avNumber: string): Promise<JavInfo | undefined> {
    /*
     * ================================================================================
     * 步骤1：请求 JavLibrary 搜索页
     * ================================================================================
     * 目标：兼容搜索页、直接详情页和 HTTP 重定向三种响应。
     * 数据源：JavLibrary 番号搜索入口。
     * 操作：
     * 1) 标准化待查询番号并生成搜索 URL
     * 2) 带成人确认 Cookie 请求页面
     */
    logger.info('开始请求 JavLibrary 番号资料', avNumber)

    const expectedAvNumber = normalizeAvNumber(avNumber)
    const params = new URLSearchParams({ keyword: avNumber })
    this.searchUrl = new URL(`vl_searchbyid.php?${params}`, this.baseUrl).href

    /*
     * ================================================================================
     * 步骤2：竞争第一方工作页与 GM 请求
     * ================================================================================
     * 目标：保留 JavLibrary 首选来源，同时避免单槽队列阻塞整个文件列表。
     * 数据源：JavLibrary 第一方工作页和带 Cookie 分区的 GM 请求。
     * 操作：
     * 1) 工作页立即开始，GM 通道延迟 1.2 秒启动
     * 2) 采用最先返回的精确结果并取消未启动任务
     */
    logger.info('开始竞争 JavLibrary 资料传输', avNumber)
    const workerTransport = createJavLibraryWorkerRequest(avNumber, this.searchUrl)
    const gmTransport = createDelayedTransport(
      signal => this.requestInfoByGM(expectedAvNumber, signal),
      GM_TRANSPORT_HEDGE_DELAY_MS,
    )
    const transports = [workerTransport, gmTransport]
    this.activeTransports.set(expectedAvNumber, transports)
    try {
      const result = await firstExactTransport(expectedAvNumber, transports)
      if (result) {
        transports.forEach((transport, index) => {
          if (index !== result.index)
            transport.cancel()
        })
        this.detailUrl = result.info.detailUrl
        logger.info('JavLibrary 资料传输竞争完成', avNumber, result.index === 0 ? 'worker' : 'gm')
        return result.info
      }

      transports.forEach(transport => transport.cancel())
      logger.info('JavLibrary 资料传输竞争完成，未找到精确结果', avNumber)
      throw new Jav.NotFound()
    }
    finally {
      if (this.activeTransports.get(expectedAvNumber) === transports)
        this.activeTransports.delete(expectedAvNumber)
    }
  }

  getDetailUrl(html: string, expectedAvNumber: string): string | undefined {
    const dom = new DOMParser().parseFromString(html, 'text/html')
    if (dom.querySelector('#video_info, #video_title')) {
      return undefined
    }

    const videos = Array.from(dom.querySelectorAll('.video'))
    const exactVideo = videos.find((video) => {
      const resultAvNumber = video.querySelector('.id')?.textContent ?? ''
      return isSameAvNumber(expectedAvNumber, resultAvNumber)
    })
    const link = exactVideo?.querySelector('a[href]')?.getAttribute('href')
    return link ? new URL(link, this.baseUrl).href : undefined
  }

  async parseInfoBefore(dom: Document): Promise<Document> {
    if (!dom.querySelector('#video_info, #video_title')) {
      throw new Jav.NotFound()
    }

    const canonicalUrl = this.getCanonicalDetailUrl(dom)
    if (canonicalUrl) {
      this.detailUrl = canonicalUrl
    }
    return dom
  }

  async parseInfoAfter(info: JavInfo): Promise<JavInfo> {
    const avNumber = info.avNumber?.trim()
    const escapedAvNumber = avNumber?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return {
      ...info,
      title: escapedAvNumber
        ? info.title?.replace(new RegExp(`^${escapedAvNumber}\\s*`, 'i'), '').trim()
        : info.title,
    }
  }

  parseAvNumber(dom: Document): JavInfo['avNumber'] {
    /*
     * ================================================================================
     * 步骤1：解析页面番号
     * ================================================================================
     * 目标：兼容 JavLibrary 当前页面把识别码节点错填为日期的结构。
     * 数据源：识别码单元格、页面标题和 Open Graph 标题。
     * 操作：
     * 1) 优先读取标准识别码节点
     * 2) 标准节点不是番号时，从页面标题提取番号
     */
    logger.info('开始解析 JavLibrary 页面番号')

    const candidates = Array.from(dom.querySelectorAll(
      '#video_id .text, #video_id td.text, #video_id [title*="番号"], [title*="番号"]',
    ))
      .map(node => node.textContent?.trim())
      .filter((value): value is string => Boolean(value))
    const direct = candidates.find(value => /[A-Z]/i.test(value) && !/^\d{4}-\d{2}-\d{2}$/.test(value))
    const result = direct || extractAvNumber(readPageTitle(dom))

    logger.info('JavLibrary 页面番号解析完成', result)
    return result
  }

  parseTitle(dom: Document): JavInfo['title'] {
    const title = dom
      .querySelector('#video_title .post-title, #video_title h3')
      ?.textContent
      ?.trim()
    return title || readPageTitle(dom)
  }

  parseDate(dom: Document): JavInfo['date'] {
    const date = dom.querySelector('#video_date .text')?.textContent?.trim()
    return date ? dayjs(date.replace(/[^\d-]/g, '')).valueOf() : undefined
  }

  parseDuration(dom: Document): JavInfo['duration'] {
    const duration = dom.querySelector('#video_length .text')?.textContent
    const minutes = duration?.match(/\d+/)?.[0]
    return minutes ? Number(minutes) : undefined
  }

  parseDirector(dom: Document): JavInfo['director'] {
    return this.parseNamedLinks(dom, '#video_director .text a, #video_director .director a')
  }

  parseActor(dom: Document): JavInfo['actors'] {
    return this
      .parseNamedLinks(dom, '#video_cast .cast .star a, #video_cast .star a')
      ?.map(actor => ({ ...actor, sex: 1 as const }))
  }

  parseStudio(dom: Document): JavInfo['studio'] {
    return this.parseNamedLinks(dom, '#video_maker .text a, #video_maker .maker a')
  }

  parsePublisher(dom: Document): JavInfo['publisher'] {
    return this.parseNamedLinks(dom, '#video_label .text a, #video_label .label a')
  }

  parseCover(dom: Document): JavInfo['cover'] {
    const cover = dom.querySelector('#video_jacket_img')?.getAttribute('src')
    return cover
      ? {
          url: new URL(cover, this.baseUrl).href,
          referer: this.detailUrl,
        }
      : undefined
  }

  parseCoverSingle(dom: Document): JavInfo['coverSingle'] {
    const cover = dom.querySelector('#video_jacket_img')?.getAttribute('src')
    if (!cover) {
      return undefined
    }

    const url = new URL(cover, this.baseUrl).href.replace(
      /pl(?=\.[a-z0-9]+(?:\?|$))/i,
      'ps',
    )
    return {
      url,
      referer: this.detailUrl,
    }
  }

  parsePreview(dom: Document): JavInfo['preview'] {
    const previews = Array.from(dom.querySelectorAll('.previewthumbs a[href]'))
      .map((preview) => {
        const raw = preview.getAttribute('href')
        const image = preview.querySelector('img')
        const thumbnail = image?.getAttribute('src') || image?.getAttribute('data-src')
        return {
          raw: raw ? new URL(raw, this.baseUrl).href : undefined,
          thumbnail: thumbnail ? new URL(thumbnail, this.baseUrl).href : undefined,
        }
      })
      .filter(preview => preview.raw || preview.thumbnail)
    return previews.length ? previews : undefined
  }

  parseSeries(dom: Document): JavInfo['series'] {
    return this.parseNamedLinks(dom, '#video_series .text a')
  }

  parseCategory(dom: Document): JavInfo['category'] {
    return this.parseNamedLinks(dom, '#video_genres .genre a')
  }

  parseScore(dom: Document): JavInfo['score'] {
    const score = dom.querySelector('#video_review .score')?.textContent?.match(/[\d.]+/)?.[0]
    return score ? Number(score) : undefined
  }

  parseScoreCount(dom: Document): JavInfo['scoreCount'] {
    const votes = dom.querySelector('#video_review .votes')?.textContent?.replace(/\D/g, '')
    return votes ? Number(votes) : undefined
  }

  /** 用 GM 请求完成搜索、精确结果定位和详情解析。 */
  private async requestInfoByGM(
    expectedAvNumber: string,
    signal?: AbortSignal,
  ): Promise<JavInfo | undefined> {
    logger.info('开始用 GM 通道请求 JavLibrary 资料', expectedAvNumber)
    const searchPage = await this.requestPage(this.searchUrl, signal)
    const detailUrl = this.getDetailUrl(searchPage.html, expectedAvNumber)
    const detailPage = detailUrl
      ? await this.requestPage(detailUrl, signal)
      : searchPage
    this.detailUrl = detailUrl ?? this.getCanonicalDetailUrl(detailPage.html) ?? detailPage.url

    const info = await this.parseInfo(detailPage.html)
    const result = isSameAvNumber(expectedAvNumber, info?.avNumber) ? info : undefined
    logger.info('GM 通道 JavLibrary 资料请求完成', expectedAvNumber, Boolean(result))
    return result
  }

  private async requestPage(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ html: string, url: string }> {
    let requestUrl = url

    for (let redirectCount = 0; redirectCount < 3; redirectCount += 1) {
      /*
       * ================================================================================
       * 步骤1：请求 JavLibrary 分区会话
       * ================================================================================
       * 目标：复用用户在正常 JavLibrary 页面取得的 Cloudflare 分区 Cookie。
       * 数据源：javlibrary.com 顶层站点 Cookie 分区和成人确认 Cookie。
       * 操作：
       * 1) 指定顶层站点分区并发起请求
       * 2) 记录状态和挑战页判定供正常浏览器现场核对
       */
      logger.info('开始请求 JavLibrary 页面', {
        requestUrl,
        cookiePartition: JAVLIBRARY_TOP_LEVEL_SITE,
      })

      const response = await this.request.get(requestUrl, {
        headers: {
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': this.baseUrl,
        },
        cookie: 'over18=18',
        cookiePartition: {
          topLevelSite: JAVLIBRARY_TOP_LEVEL_SITE,
        },
        signal,
        timeout: 10000,
      })
      const html = await response.text()
      const cloudflareChallenge = CLOUDFLARE_CHALLENGE_PATTERN.test(html)

      logger.info('JavLibrary 页面请求完成', {
        requestUrl,
        status: response.status,
        cloudflareChallenge,
      })

      if (response.status === 404) {
        throw new Jav.NotFound()
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) {
          throw new Jav.PageError()
        }
        requestUrl = new URL(location, requestUrl).href
        continue
      }
      if (response.status !== 200) {
        throw new Jav.PageError()
      }
      if (cloudflareChallenge) {
        throw new Jav.PageError()
      }

      return {
        html,
        url: requestUrl,
      }
    }

    throw new Jav.PageError()
  }

  private getCanonicalDetailUrl(htmlOrDom: string | Document): string | undefined {
    const dom = typeof htmlOrDom === 'string'
      ? new DOMParser().parseFromString(htmlOrDom, 'text/html')
      : htmlOrDom
    const href = dom.querySelector('#video_title a[href]')?.getAttribute('href')
    return href ? new URL(href, this.baseUrl).href : undefined
  }

  private parseNamedLinks(dom: Document, selector: string) {
    const links = Array.from(dom.querySelectorAll(selector))
      .map((link) => {
        const name = link.textContent?.trim()
        const href = link.getAttribute('href')
        return name
          ? {
              name,
              url: href ? new URL(href, this.baseUrl).href : undefined,
            }
          : undefined
      })
      .filter((link): link is { name: string, url: string | undefined } => !!link)
    return links.length ? links : undefined
  }
}
