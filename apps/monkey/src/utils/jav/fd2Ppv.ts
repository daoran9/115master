import type { JavInfo } from './jav'
import dayjs from 'dayjs'
import { appLogger } from '@/utils/logger'
import { Jav, JAV_SOURCE, normalizeAvNumber } from './jav'

const logger = appLogger.sub('Fd2Ppv')
const TOP_LEVEL_SITE = 'https://fd2ppv.cc'

/** 判断当前查询是否属于 FC2 PPV 系列。 */
export function isFd2PpvAvNumber(avNumber: string): boolean {
  return /^FC2PPV\d{5,8}$/.test(normalizeAvNumber(avNumber))
}

/** 从统一番号中读取 FD2 使用的纯数字作品编号。 */
function getArticleId(avNumber: string): string | undefined {
  return normalizeAvNumber(avNumber).match(/^FC2PPV(\d{5,8})$/)?.[1]
}

/** 把 FD2 的时分秒文本转换成项目统一使用的分钟数。 */
function parseDurationText(value?: string): number | undefined {
  const parts = value?.trim().split(':').map(Number)
  if (!parts?.length || parts.some(Number.isNaN))
    return undefined
  const [hours = 0, minutes = 0, seconds = 0]
    = parts.length === 3 ? parts : [0, ...parts]
  return Math.max(1, Math.round(hours * 60 + minutes + seconds / 60))
}

/** FD2 的 FC2 PPV 作品资料源。 */
export class Fd2Ppv extends Jav {
  source = JAV_SOURCE.FD2PPV
  baseUrl = TOP_LEVEL_SITE
  detailUrl = ''
  searchUrl = ''
  labels: Record<string, Element | undefined> = {}

  async getInfoByAvNumber(avNumber: string) {
    /*
     * ================================================================================
     * 步骤1：请求 FC2 精确作品页
     * ================================================================================
     * 目标：只为 FC2 PPV 番号访问 FD2，并复用用户通过 Cloudflare 的站点分区。
     * 数据源：番号中的纯数字作品编号和 FD2 详情页。
     * 操作：
     * 1) 校验 FC2 PPV 番号并生成固定详情地址
     * 2) 用 fd2ppv.cc 顶层 Cookie 分区读取页面
     */
    logger.info('开始请求 FD2 番号资料', avNumber)

    /** 1.1 普通番号不访问 FC2 专用来源。 */
    const articleId = getArticleId(avNumber)
    if (!articleId) {
      logger.info('FD2 番号资料请求完成，非 FC2 番号', avNumber)
      throw new Jav.NotFound()
    }

    // 1.2 详情地址由纯数字作品编号唯一确定，不使用模糊搜索。
    this.detailUrl = new URL(`/articles/${articleId}`, this.baseUrl).href
    this.searchUrl = this.detailUrl
    const response = await this.request.get(this.detailUrl, {
      headers: { Referer: `${this.baseUrl}/` },
      cookiePartition: { topLevelSite: TOP_LEVEL_SITE },
    })
    if (response.status === 404) {
      logger.info('FD2 番号资料请求完成，未找到', avNumber)
      throw new Jav.NotFound()
    }
    if (response.status !== 200 && response.status !== 302) {
      logger.info('FD2 番号资料请求完成，页面异常', avNumber, response.status)
      throw new Jav.PageError()
    }

    const info = await this.parseInfo(await response.text())
    logger.info('FD2 番号资料请求完成', avNumber, Boolean(info))
    return info
  }

  async parseInfoBefore(dom: Document): Promise<Document> {
    /*
     * ================================================================================
     * 步骤1：建立 FD2 元数据索引
     * ================================================================================
     * 目标：页面字段顺序变化时仍按标签名称取值。
     * 数据源：work-meta-label 与相邻 work-meta-value。
     * 操作：
     * 1) 收集可见标签
     * 2) 保存标签到值节点的映射
     */
    logger.info('开始建立 FD2 元数据索引')

    // 1.1 详情字段使用标签和值相邻的稳定结构。
    this.labels = Object.fromEntries(
      Array.from(dom.querySelectorAll('.work-meta-label')).map(label => [
        label.textContent?.trim() ?? '',
        label.nextElementSibling ?? undefined,
      ]),
    )

    logger.info('FD2 元数据索引建立完成', Object.keys(this.labels).length)
    return dom
  }

  parseAvNumber(dom: Document): JavInfo['avNumber'] {
    const articleId = dom.querySelector('.work-title')?.textContent?.match(/\d{5,8}/)?.[0]
    return articleId ? `FC2-PPV-${articleId}` : undefined
  }

  parseTitle(dom: Document): JavInfo['title'] {
    const title = dom.querySelector('.work-brief')?.textContent?.trim()
      || dom.querySelector('meta[name="description"]')?.getAttribute('content')?.replace(/^FC2\s*PPV\s*\d+\s*/i, '').trim()
    return title || undefined
  }

  parseDate(): JavInfo['date'] {
    const date = this.labels['發佈日期']?.textContent?.trim()
    return date ? dayjs(date).valueOf() : undefined
  }

  parseDuration(): JavInfo['duration'] {
    return parseDurationText(this.labels['片長']?.textContent ?? undefined)
  }

  parseDirector(): JavInfo['director'] {
    return undefined
  }

  parseActor(dom: Document): JavInfo['actors'] {
    const actors = Array.from(
      dom.querySelectorAll('.artist-name a[href], .artist-details a.artistUrl[href]'),
    ).map(actor => ({
      name: actor.textContent?.trim() ?? '',
      url: new URL(actor.getAttribute('href')!, this.baseUrl).href,
      sex: 1 as const,
    })).filter(actor => Boolean(actor.name))
    return actors.length ? actors : undefined
  }

  parseStudio(): JavInfo['studio'] {
    const studio = this.labels['賣家']?.textContent?.trim()
    return studio ? [{ name: studio }] : undefined
  }

  parsePublisher(): JavInfo['publisher'] {
    const publisher = this.labels['發行商']?.textContent?.trim()
    return publisher ? [{ name: publisher }] : undefined
  }

  parseCover(dom: Document): JavInfo['cover'] {
    const cover = dom.querySelector('.work-photos img[src]')?.getAttribute('src')
    return cover
      ? { url: new URL(cover, this.baseUrl).href, referer: this.detailUrl }
      : undefined
  }

  parseCoverSingle(dom: Document): JavInfo['coverSingle'] {
    return this.parseCover(dom)
  }

  parsePreview(dom: Document): JavInfo['preview'] {
    const urls = new Set<string>()
    const originalPhotos = dom.querySelector('.work-original-photos')?.textContent ?? ''
    originalPhotos.match(/https?:\/\/\S+/g)?.forEach(url => urls.add(url))
    dom.querySelectorAll('.work-photos img[src]').forEach((image) => {
      const url = image.getAttribute('src')
      if (url)
        urls.add(new URL(url, this.baseUrl).href)
    })
    return urls.size ? Array.from(urls, raw => ({ raw, thumbnail: raw })) : undefined
  }

  parseSeries(): JavInfo['series'] {
    return undefined
  }

  parseCategory(dom: Document): JavInfo['category'] {
    const categories = Array.from(dom.querySelectorAll('.work-tags a[href]'))
      .map(category => ({
        name: category.textContent?.trim() ?? '',
        url: new URL(category.getAttribute('href')!, this.baseUrl).href,
      }))
      .filter(category => Boolean(category.name))
    return categories.length ? categories : undefined
  }

  parseComments(): JavInfo['comments'] {
    return undefined
  }
}
