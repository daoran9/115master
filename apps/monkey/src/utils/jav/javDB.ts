import type { JavInfo } from './jav'
import dayjs from 'dayjs'
import { appLogger } from '@/utils/logger'
import { isSameAvNumber, Jav, JAV_SOURCE } from './jav'

const logger = appLogger.sub('JavDB')

/**
 * ================================================================================
 * 步骤1：读取 JavDB 封面地址
 * ================================================================================
 * 目标：兼容 JavDB 延迟加载封面，优先使用 data-src 中的真实地址。
 * 数据源：详情页 img.video-cover 的 data-src 和 src 属性。
 * 操作：
 * 1) 优先读取 data-src
 * 2) 忽略空值和 data: 占位地址
 * 3) 没有真实 data-src 时回退 src
 */
function readCoverUrl(dom: Document): string | undefined {
  logger.info('开始读取 JavDB 封面地址')

  const image = dom.querySelector('img.video-cover')
  const candidates = [
    image?.getAttribute('data-src'),
    image?.getAttribute('src'),
  ]
  const cover = candidates
    .map(value => value?.trim())
    .find(value => Boolean(value) && !value!.startsWith('data:'))

  logger.info('JavDB 封面地址读取完成', cover ?? '')
  return cover
}

/**
 * JavDB 类
 */
export class JavDB extends Jav {
  source = JAV_SOURCE.JAVDB
  baseUrl = 'https://javdb.com'
  detailUrl = ''
  searchUrl = ''
  labels: { [k: string]: Element | undefined } = {}

  async getInfoByAvNumber(avNumber: string) {
    const params = new URLSearchParams({
      q: avNumber,
    })
    const searchUrl = new URL(`/search?${params.toString()}`, this.baseUrl)
      .href
    this.searchUrl = searchUrl
    const html = await this.request.get(searchUrl)
    if (html.status === 404) {
      throw new Jav.NotFound()
    }
    if (html.status !== 200 && html.status !== 302) {
      throw new Jav.PageError()
    }

    const detailUrl = this.getDetailUrl(await html.text(), avNumber)
    if (!detailUrl) {
      throw new Jav.PageError()
    }
    this.detailUrl = detailUrl
    const avNumberPageResponse = await this.request.get(detailUrl)

    if (avNumberPageResponse.status === 404) {
      throw new Jav.NotFound()
    }
    if (
      avNumberPageResponse.status !== 200
      && avNumberPageResponse.status !== 302
    ) {
      throw new Jav.PageError()
    }
    return await this.parseInfo(await avNumberPageResponse.text())
  }

  getDetailUrl(html: string, avNumber: string) {
    /*
     * ================================================================================
     * 步骤1：从搜索结果定位精确番号
     * ================================================================================
     * 目标：相似番号并列时不再默认打开第一项。
     * 数据源：JavDB 搜索结果卡片。
     * 操作：
     * 1) 逐项读取卡片番号
     * 2) 只返回标准化后完全一致的详情链接
     */
    logger.info('开始定位 JavDB 精确番号', avNumber)
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const items = Array.from(dom.querySelectorAll('.movie-list .item'))
    const exactItem = items.find((item) => {
      const resultAvNumber = item
        .querySelector('.video-title strong, .uid, [data-number]')
        ?.textContent
        ?.trim()
      return isSameAvNumber(avNumber, resultAvNumber)
    })
    const page = exactItem?.querySelector('a[href]')?.getAttribute('href')
    logger.info('JavDB 精确番号定位完成', avNumber, page ?? '')
    return page ? new URL(page, this.baseUrl).href : undefined
  }

  async parseInfoBefore(dom: Document): Promise<Document> {
    const labels = this.getLabels(dom)
    this.labels = labels
    return dom
  }

  getLabels(dom: Document) {
    const headers = dom.querySelectorAll('.container .panel-block strong')
    return Object.fromEntries(
      Array.from(headers).map(i => [
        i.textContent?.replace(':', '').trim(),
        i,
      ]),
    )
  }

  parseAvNumber() {
    const avNumber = this.labels['番號']?.parentElement
      ?.querySelector('.value')
      ?.textContent
      ?.trim()
    return avNumber ?? undefined
  }

  parseTitle(dom: Document) {
    const title = dom.querySelector('.current-title')?.textContent?.trim()
    return title ?? undefined
  }

  parseDate() {
    const date = this.labels['日期']?.parentElement
      ?.querySelector('.value')
      ?.textContent
      ?.trim()
    return date ? dayjs(date.replace(/[^\d-]/g, '')).valueOf() : 0
  }

  parseDuration() {
    const duration = this.labels['時長']?.parentElement
      ?.querySelector('.value')
      ?.textContent
      ?.trim()
    return duration ? Number(duration.replace(/\D/g, '')) : 0
  }

  parseDirector() {
    const directors
      = this.labels['導演']?.parentElement?.querySelectorAll('.value a')
    return directors?.length
      ? Array.from(directors)
          .map(i => ({
            name: i.textContent!,
            url: i.getAttribute('href') ?? undefined,
          }))
          .map(i => ({
            ...i,
            url: i.url ? new URL(i.url, this.baseUrl).href : undefined,
          }))
      : undefined
  }

  parseActor() {
    const actors
      = this.labels['演員']?.parentElement?.querySelectorAll('.value a')
    return actors?.length
      ? Array.from(actors).map((i) => {
          const href = i.getAttribute('href') ?? undefined
          const url = href ? new URL(href, this.baseUrl).href : undefined
          const file = href?.split('/').pop()
          /** 前两位是分组 */
          const fileGroup = file?.slice(0, 2).toLowerCase()
          const face = `https://c0.jdbstatic.com/avatars/${fileGroup}/${file}.jpg`
          return {
            name: i.textContent!,
            url,
            face,
            faceReferer: url || this.detailUrl,
            sex: i.nextElementSibling?.classList.contains('female')
              ? (1 as const)
              : i.nextElementSibling?.classList.contains('male')
                ? (0 as const)
                : undefined,
          }
        })
      : undefined
  }

  parseStudio() {
    const studios
      = this.labels['片商']?.parentElement?.querySelectorAll('.value a')
    return studios?.length
      ? Array.from(studios)
          .map(i => ({
            name: i.textContent!,
            url: i.getAttribute('href') ?? undefined,
          }))
          .map(i => ({
            ...i,
            url: i.url ? new URL(i.url, this.baseUrl).href : undefined,
          }))
      : undefined
  }

  parsePublisher() {
    return undefined
  }

  parseCover(dom: Document) {
    const cover = readCoverUrl(dom)
    return cover
      ? {
          url: new URL(cover, this.baseUrl).href,
          referer: this.detailUrl,
        }
      : undefined
  }

  parseCoverSingle(dom: Document): JavInfo['coverSingle'] {
    /*
     * ================================================================================
     * 步骤1：解析 JavDB 单页封面
     * ================================================================================
     * 目标：从双页 covers 地址推导同资源的竖版 thumbs 地址，不返回空 URL。
     * 数据源：详情页 img.video-cover。
     * 操作：
     * 1) 读取并标准化封面 URL
     * 2) 把 /covers/ 映射为 /thumbs/，未知格式保留有效原图
     */
    logger.info('开始解析 JavDB 单页封面')

    const cover = readCoverUrl(dom)
    if (!cover) {
      logger.info('JavDB 单页封面解析完成，无封面')
      return undefined
    }

    const url = new URL(cover, this.baseUrl).href.replace('/covers/', '/thumbs/')
    logger.info('JavDB 单页封面解析完成', url)
    return {
      url,
      referer: this.detailUrl,
    }
  }

  parsePreview(dom: Document) {
    const previews = dom.querySelectorAll('.preview-images .tile-item')
    return previews.length
      ? Array.from(previews)
          .map(i => ({
            raw: i?.getAttribute('href') ?? undefined,
            thumbnail: i.querySelector('img')?.getAttribute('src') ?? undefined,
          }))
          .filter(i => !!i.raw || !!i.thumbnail)
      : undefined
  }

  parseSeries() {
    const series
      = this.labels['系列']?.parentElement?.querySelectorAll('.value a')
    return series?.length
      ? Array.from(series)
          .map(i => ({
            name: i.textContent!,
            url: i.getAttribute('href') ?? undefined,
          }))
          .map(i => ({
            ...i,
            url: i.url ? new URL(i.url, this.baseUrl).href : undefined,
          }))
      : undefined
  }

  parseCategory() {
    const categories
      = this.labels['類別']?.parentElement?.querySelectorAll('.value a')
    return categories?.length
      ? Array.from(categories)
          .map(i => ({
            name: i.textContent!,
            url: i.getAttribute('href') ?? undefined,
          }))
          .map(i => ({
            ...i,
            url: i.url ? new URL(i.url, this.baseUrl).href : undefined,
          }))
      : undefined
  }

  parseComments() {
    return []
  }
}
