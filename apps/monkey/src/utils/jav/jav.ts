import { javCache } from '@/utils/cache/javCache'
import { appLogger } from '@/utils/logger'
import { GMRequest } from '@/utils/request/gmRequest'

const logger = appLogger.sub('Jav')

/** 来源 */
export enum JAV_SOURCE {
  FANZA = 'FANZA',
  FD2PPV = 'FD2PPV',
  JAVBUS = 'JavBus',
  JAVDB = 'JavDB',
  JAVLIBRARY = 'JavLibrary',
  MISSAV = 'MissAV',
}

/** 导演 */
interface Director {
  /** 名称 */
  name: string
  /** 链接 */
  url?: string
}

/** 演员 */
interface Actor {
  /** 名称 */
  name: string
  /** 链接 */
  url?: string
  /** 性别 */
  sex?: 0 | 1
  /** face */
  face?: string
  /** 头像防盗链来源页 */
  faceReferer?: string
}

/** 类别 */
interface Category {
  /** 名称 */
  name: string
  /** 链接 */
  url?: string
}

/** 系列 */
interface Series {
  /** 名称 */
  name: string
  /** 链接 */
  url?: string
}

/** 片商 */
interface Studio {
  /** 名称 */
  name: string
  /** 链接 */
  url?: string
}

/** 发行商 */
interface Publisher {
  /** 名称 */
  name: string
  /** 链接 */
  url?: string
}

/** 预览图 */
interface Preview {
  /** 链接 */
  raw?: string
  /** 缩略图 */
  thumbnail?: string
}

interface Comment {
  /** 内容 */
  content: string
  /** 名称 */
  name: string
  /** 头像 */
  avatar?: string
  /** 评分 */
  score: number
  /** 时间 */
  time: number
  /** 点赞数 */
  likeCount: number
}

interface Cover {
  /** 链接 */
  url: string
  /** 基础 URL */
  referer?: string
}

/** 番号信息 */
export interface JavInfo {
  /** 来源 */
  source: JAV_SOURCE
  /** 基础 URL */
  baseUrl: string
  /** 链接 */
  detailUrl: string
  /** 搜索链接 */
  searchUrl: string
  /** 番号 */
  avNumber?: string
  /** 标题 */
  title?: string
  /** 日期 */
  date?: number
  /** 时长 */
  duration?: number
  /** 导演 */
  director?: Director[]
  /** 演员 */
  actors?: Actor[]
  /** 片商 */
  studio?: Studio[]
  /** 发行商 */
  publisher?: Publisher[]
  /** 封面（双页） */
  cover?: Cover
  /** 封面（单页） */
  coverSingle?: Cover
  /** 低优先级来源和同源单页封面候选 */
  coverFallbacks?: Cover[]
  /** 预览图 */
  preview?: Preview[]
  /** 系列 */
  series?: Series[]
  /** 类别 */
  category?: Category[]
  /** 评分 */
  score?: number
  /** 评价人数 */
  scoreCount?: number
  /** 观看人数 */
  viewCount?: number
  /** 下载人数 */
  downloadCount?: number
  /** 评论 */
  comments?: Comment[]
}

/** 把番号统一为只含大写字母和数字的比较键。 */
export function normalizeAvNumber(avNumber?: string | null): string {
  return avNumber
    ?.normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') ?? ''
}

/** 判断两个番号是否仅存在大小写或分隔符差异。 */
export function isSameAvNumber(
  expectedAvNumber?: string | null,
  actualAvNumber?: string | null,
): boolean {
  const expected = normalizeAvNumber(expectedAvNumber)
  return Boolean(expected && expected === normalizeAvNumber(actualAvNumber))
}

/** 判断资料是否属于当前查询番号。 */
export function isJavInfoForAvNumber(
  avNumber: string,
  info?: JavInfo | null,
): boolean {
  return Boolean(
    info?.avNumber
    && isSameAvNumber(avNumber, info.avNumber),
  )
}

/** 只有具备列表详情核心字段且番号一致的数据才写入长期缓存。 */
export function isJavInfoCacheable(
  info?: JavInfo | null,
  avNumber?: string,
): info is JavInfo {
  return Boolean(
    info?.avNumber?.trim()
    && info.title?.trim()
    && (info.cover?.url || info.coverSingle?.url)
    && (!avNumber || isJavInfoForAvNumber(avNumber, info)),
  )
}

/** 未找到番号 */
export class JavNotFound extends Error {
  constructor() {
    super('未找到番号')
  }
}

/** 请求页面错误 */
export class JavPageError extends Error {
  constructor() {
    super('请求页面错误')
  }
}

/** Jav 抽象类 */
abstract class Jav {
  /** 未找到番号 */
  static NotFound = JavNotFound
  /** 请求页面错误 */
  static PageError = JavPageError
  /** 请求实例 */
  request = new GMRequest()
  /** 缓存实例 */
  private cache = javCache
  /** 基础 URL */
  abstract baseUrl: string
  /** 链接 */
  abstract detailUrl: string
  /** 搜索链接 */
  abstract searchUrl: string
  /** 来源 */
  abstract source: JAV_SOURCE

  /** 获取番号信息 */
  async getInfo(avNumber: string): Promise<JavInfo | undefined> {
    /*
     * ================================================================================
     * 步骤1：读取并核对单源缓存
     * ================================================================================
     * 目标：只复用当前番号的完整资料，旧错误缓存不能继续污染页面。
     * 数据源：以来源和请求番号组成的 IndexedDB 缓存。
     * 操作：
     * 1) 读取缓存并复核返回番号
     * 2) 完整缓存直接返回；不完整缓存继续联网刷新
     */
    logger.info('开始读取单源番号资料', this.source, avNumber)
    const info = await this.getInfoByCache(avNumber)
    if (isJavInfoCacheable(info, avNumber)) {
      logger.info('单源番号资料读取完成，命中完整缓存', this.source, avNumber)
      return info
    }

    logger.info('单源番号资料缓存读取完成，开始联网刷新', this.source, avNumber)

    /*
     * ================================================================================
     * 步骤2：请求并复核网络资料
     * ================================================================================
     * 目标：禁止相似番号响应写入当前番号缓存。
     * 数据源：当前 Jav 资料源的搜索页或详情页。
     * 操作：
     * 1) 请求并解析详情
     * 2) 核对番号后按完整度决定是否缓存
     */
    logger.info('开始请求单源番号资料', this.source, avNumber)
    const infoNew = await this.getInfoByAvNumber(avNumber)
    if (!isJavInfoForAvNumber(avNumber, infoNew)) {
      if (infoNew?.avNumber) {
        logger.warn('单源番号不一致，忽略资料', this.source, avNumber, infoNew.avNumber)
      }
      logger.info('单源番号资料请求完成，无精确结果', this.source, avNumber)
      return info
    }
    if (isJavInfoCacheable(infoNew, avNumber)) {
      await this.cache.set(`${this.source}:${avNumber}`, infoNew)
    }
    logger.info('单源番号资料请求完成', this.source, avNumber)
    return infoNew
  }

  /** 获取番号信息缓存 */
  async getInfoByCache(avNumber: string): Promise<JavInfo | undefined> {
    const info = await this.cache.get(`${this.source}:${avNumber}`)
    if (!info) {
      return undefined
    }
    if (!isJavInfoForAvNumber(avNumber, info.value)) {
      logger.warn(
        '单源番号缓存不一致，忽略缓存',
        this.source,
        avNumber,
        info.value.avNumber,
      )
      return undefined
    }
    return info.value
  }

  /** 解析番号信息 */
  async parseInfo(html: string): Promise<JavInfo | undefined> {
    let dom = new DOMParser().parseFromString(html, 'text/html')
    try {
      dom = await this.parseInfoBefore(dom)
    }
    catch {
      return undefined
    }
    const info: JavInfo = {
      source: this.source,
      baseUrl: this.baseUrl,
      detailUrl: this.detailUrl,
      searchUrl: this.searchUrl,
      avNumber: this.parseAvNumber(dom),
      title: this.parseTitle(dom),
      date: this.parseDate(dom),
      duration: this.parseDuration(dom),
      director: this.parseDirector(dom),
      actors: this.parseActor(dom),
      studio: this.parseStudio(dom),
      publisher: this.parsePublisher(dom),
      cover: this.parseCover(dom),
      coverSingle: this.parseCoverSingle(dom),
      preview: this.parsePreview(dom),
      series: this.parseSeries(dom),
      category: this.parseCategory(dom),
      score: this.parseScore?.(dom),
      scoreCount: this.parseScoreCount?.(dom),
      viewCount: this.parseViewCount?.(dom),
      downloadCount: this.parseDownloadCount?.(dom),
      comments: this.parseComments?.(dom),
    }
    const infoAfter = await this.parseInfoAfter(info)
    return infoAfter
  }

  /** 解析番号信息后 */
  async parseInfoBefore(dom: Document) {
    return dom
  }

  /** 解析番号信息后 */
  async parseInfoAfter(info: JavInfo) {
    return Promise.resolve(info)
  }

  /** 通过番号获取番号信息 */
  abstract getInfoByAvNumber(avNumber: string): Promise<JavInfo | undefined>

  /** 解析番号 */
  abstract parseAvNumber(dom: Document): string | undefined

  /** 解析标题 */
  abstract parseTitle(dom: Document): string | undefined

  /** 解析日期 */
  abstract parseDate(dom: Document): number | undefined

  /** 解析时长 */
  abstract parseDuration(dom: Document): number | undefined

  /** 解析导演 */
  abstract parseDirector(dom: Document): Director[] | undefined

  /** 解析演员 */
  abstract parseActor(dom: Document): Actor[] | undefined

  /** 解析片商 */
  abstract parseStudio(dom: Document): Studio[] | undefined

  /** 解析发行商 */
  abstract parsePublisher(dom: Document): Publisher[] | undefined

  /** 解析封面 */
  abstract parseCover(dom: Document): Cover | undefined

  /** 解析封面（单页） */
  abstract parseCoverSingle(dom: Document): Cover | undefined

  /** 解析预览图 */
  abstract parsePreview(dom: Document): Preview[] | undefined

  /** 解析系列 */
  abstract parseSeries(dom: Document): Series[] | undefined

  /** 解析类别 */
  abstract parseCategory(dom: Document): Category[] | undefined

  /** 解析评分 */
  parseScore?(dom: Document): number | undefined

  /** 解析评分人数 */
  parseScoreCount?(dom: Document): number | undefined

  /** 解析观看人数 */
  parseViewCount?(dom: Document): number | undefined

  /** 解析下载人数 */
  parseDownloadCount?(dom: Document): number | undefined

  /** 解析评论 */
  parseComments?(dom: Document): Comment[] | undefined
}

export type {
  Actor,
  JavInfo as AvInfo,
  Category,
  Director,
  Publisher,
  Series,
  Studio,
}

export { Jav }
