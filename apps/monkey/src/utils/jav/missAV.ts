import type { JavInfo } from './jav'
import dayjs from 'dayjs'
import { performerFaceCache } from '@/utils/cache/performerFaceCache'
import { getAvNumber } from '@/utils/getNumber'
import { appLogger } from '@/utils/logger'
import { GMRequest } from '@/utils/request/gmRequest'
import { Jav, JAV_SOURCE } from './jav'

const logger = appLogger.sub('MissAV')
const MISSAV_TOP_LEVEL_SITE = 'https://missav.ws'

/** 统一演员姓名，限制跨来源头像只能精确匹配。 */
function normalizeActorName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
}

/** 从 MissAV 演员页地址读取不受页面翻译影响的姓名。 */
function getActorNameFromUrl(url?: string): string {
  if (!url)
    return ''
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
  }
  catch {
    return ''
  }
}

/**
 * MissAV 类
 */
export class MissAV extends Jav {
  source = JAV_SOURCE.MISSAV
  baseUrl = 'https://missav.ws/cn/'
  detailUrl = ''
  searchUrl = ''
  labels: { [k: string]: Element | undefined } = {}
  request = new GMRequest({
    cookiePartition: { topLevelSite: MISSAV_TOP_LEVEL_SITE },
    redirect: 'follow',
    timeout: 12000,
  })

  async getInfoByAvNumber(avNumber: string) {
    const detailUrl = new URL(avNumber, this.baseUrl).href
    this.searchUrl = new URL(`/search/${encodeURIComponent(avNumber)}`, this.baseUrl).href

    if (!detailUrl) {
      throw new Jav.NotFound()
    }
    this.detailUrl = detailUrl
    let avNumberPageResponse = await this.request.get(detailUrl)
    if (avNumberPageResponse.status === 301) {
      const redirectUrl = avNumberPageResponse.headers.get('location')
      if (!redirectUrl) {
        throw new Jav.PageError()
      }
      this.detailUrl = redirectUrl
      avNumberPageResponse = await this.request.get(redirectUrl)
    }
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

  async parseInfoBefore(dom: Document): Promise<Document> {
    const labels = this.getLabels(dom)
    this.labels = labels
    return dom
  }

  getLabels(dom: Document) {
    const headers = dom.querySelectorAll(
      '.space-y-2 > div > span:first-of-type',
    )
    return Object.fromEntries(
      Array.from(headers).map(i => [
        i.textContent?.replace(':', '').trim(),
        i,
      ]),
    )
  }

  parseAvNumber(dom: Document): JavInfo['avNumber'] {
    /*
     * ================================================================================
     * 步骤1：解析 MissAV 番号
     * ================================================================================
     * 目标：详情字段结构变化时仍从页面标题识别精确番号。
     * 数据源：番号标签、Open Graph 标题和 document.title。
     * 操作：
     * 1) 优先读取结构化番号标签
     * 2) 标签缺失时复用文件番号提取器读取页面标题
     */
    logger.info('开始解析 MissAV 番号')

    /** 1.1 兼容旧版详情标签。 */
    const labelAvNumber = this.labels['番号']?.nextElementSibling?.textContent?.trim()
    /** 1.2 当前页面主要把番号放在 og:title 或 title 开头。 */
    const pageTitle = this.getPageTitle(dom)
    const avNumber = labelAvNumber || getAvNumber(pageTitle)
    logger.info('MissAV 番号解析完成', avNumber ?? '')
    return avNumber ?? undefined
  }

  parseTitle(dom: Document): JavInfo['title'] {
    /*
     * ================================================================================
     * 步骤1：解析 MissAV 标题
     * ================================================================================
     * 目标：详情标签缺失时仍保留页面标题，并去掉番号和站点后缀。
     * 数据源：标题标签、Open Graph 标题和 document.title。
     * 操作：
     * 1) 选择可用标题来源
     * 2) 清理站点后缀及开头番号
     */
    logger.info('开始解析 MissAV 标题')

    /** 1.1 旧详情标签优先，当前页面使用 Open Graph 标题。 */
    const rawTitle = this.labels['标题']?.nextElementSibling?.textContent?.trim()
      || this.getPageTitle(dom)
    const avNumber = this.parseAvNumber(dom)
    const escapedAvNumber = avNumber?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    /** 1.2 页面标题常带 MissAV 站点说明，只保留影片标题。 */
    const title = rawTitle
      .replace(/\s*-\s*MissAV.*$/i, '')
      .replace(escapedAvNumber ? new RegExp(`^${escapedAvNumber}\\s*`, 'i') : /^$/, '')
      .trim()
    logger.info('MissAV 标题解析完成', title)
    return title || undefined
  }

  parseDate(): JavInfo['date'] {
    const date = this.labels['日期']?.nextElementSibling?.textContent?.trim()
    return date ? dayjs(date.replace(/[^\d-]/g, '')).valueOf() : 0
  }

  parseDuration(): JavInfo['duration'] {
    return undefined
  }

  parseDirector(): JavInfo['director'] {
    const directors = this.labels['导演']?.parentElement?.querySelectorAll('a')
    return directors?.length
      ? Array.from(directors).map(i => ({
          name: i.textContent!,
          url: i.getAttribute('href') ?? undefined,
        }))
      : undefined
  }

  parseActor(dom: Document): JavInfo['actors'] {
    /*
     * ================================================================================
     * 步骤1：解析 MissAV 演员链接
     * ================================================================================
     * 目标：保留影片与演员页的精确关联，供播放器按需补头像。
     * 数据源：详情标签和当前页面的 actresses 链接。
     * 操作：
     * 1) 优先读取女优和男优标签
     * 2) 标签变化时回退到演员页链接并去重
     */
    logger.info('开始解析 MissAV 演员链接')

    const femaleActors
      = this.labels['女优']?.parentElement?.querySelectorAll('a')
    const maleActors
      = this.labels['男优']?.parentElement?.querySelectorAll('a')
    const labeledActors = [
      ...(femaleActors?.length
        ? Array.from(femaleActors).map(i => ({
            name: i.textContent?.trim() ?? '',
            url: this.resolveActorUrl(i.getAttribute('href')),
            sex: 1 as const,
          }))
        : []),
      ...(maleActors?.length
        ? Array.from(maleActors).map(i => ({
            name: i.textContent?.trim() ?? '',
            url: this.resolveActorUrl(i.getAttribute('href')),
            sex: 0 as const,
          }))
        : []),
    ]
    const fallbackActors = Array.from(
      dom.querySelectorAll('a[href*="/actresses/"]'),
    ).map(i => ({
      name: i.textContent?.trim() || getActorNameFromUrl(this.resolveActorUrl(i.getAttribute('href'))),
      url: this.resolveActorUrl(i.getAttribute('href')),
      sex: 1 as const,
    }))
    const seen = new Set<string>()
    const actors = [...labeledActors, ...fallbackActors]
      .filter(actor => actor.name && actor.url && !actor.url.endsWith('/actresses/ranking'))
      .filter((actor) => {
        /** 1.1 姓名和链接同时去重，避免详情中的图文链接生成两名演员。 */
        const key = `${normalizeActorName(actor.name)}\u0000${actor.url}`
        if (seen.has(key))
          return false
        seen.add(key)
        return true
      })

    logger.info('MissAV 演员链接解析完成', actors.length)
    return actors.length ? actors : undefined
  }

  /** 只为播放器当前演员按需加载 MissAV 头像。 */
  async getActorFacesByAvNumber(
    avNumber: string,
    expectedActorNames: string[],
  ): Promise<NonNullable<JavInfo['actors']>> {
    /*
     * ================================================================================
     * 步骤1：读取演员头像长期缓存
     * ================================================================================
     * 目标：已经核对过的演员不再请求影片详情和演员页。
     * 数据源：播放器当前演员名和长期头像映射。
     * 操作：
     * 1) 标准化并去重播放器演员名
     * 2) 并行读取已有 MissAV 头像映射
     */
    logger.info('开始读取 MissAV 演员头像缓存', avNumber)

    /** 1.1 只接受播放器已显示的姓名，禁止热门榜模糊匹配。 */
    const expectedNames = Array.from(new Map(
      expectedActorNames
        .map(name => name.trim())
        .filter(Boolean)
        .map(name => [normalizeActorName(name), name]),
    ))
    const cachedActors = await Promise.all(expectedNames.map(async ([key]) =>
      (await performerFaceCache.getByName(key))?.actor ?? null))
    const result = cachedActors.filter((actor): actor is NonNullable<typeof actor> => Boolean(actor?.face))
    const missingNames = expectedNames.filter((_, index) => !cachedActors[index])
    logger.info('MissAV 演员头像缓存读取完成', avNumber, result.length, missingNames.length)

    if (missingNames.length === 0)
      return result

    /*
     * ================================================================================
     * 步骤2：从影片详情核对演员链接
     * ================================================================================
     * 目标：只请求确实属于当前番号且姓名精确对应的 MissAV 演员页。
     * 数据源：当前番号 MissAV 详情和播放器缺图演员名。
     * 操作：
     * 1) 请求并解析当前番号详情
     * 2) 先精确匹配；同一影片仅一个短名候选时兼容来源省略姓氏
     */
    logger.info('开始核对 MissAV 影片演员', avNumber)

    /** 2.1 演员是可选字段，旧完整缓存缺演员时必须重新读取详情页。 */
    const cachedInfo = await this.getInfoByCache(avNumber)
    const info = cachedInfo?.actors?.length
      ? cachedInfo
      : await this.getInfoByAvNumber(avNumber)
    const missAVActors = info?.actors ?? []
    const matchedActors = missingNames.flatMap(([expectedKey, expectedName]) => {
      /** 2.2 先精确匹配；同一影片只有一个前后缀短名候选时才兼容站点省略姓氏。 */
      const candidates = missAVActors.map(actor => ({
        actor,
        names: [actor.name, getActorNameFromUrl(actor.url)]
          .map(normalizeActorName)
          .filter(Boolean),
      }))
      const exactActor = candidates.find(candidate => candidate.names.includes(expectedKey))?.actor
      const compatibleActors = exactActor
        ? []
        : candidates.filter(candidate => candidate.names.some(name =>
            isCompatibleActorAlias(expectedKey, name)))
      const actor = exactActor || (compatibleActors.length === 1 ? compatibleActors[0].actor : undefined)
      return actor?.url ? [{ actor, expectedKey, expectedName }] : []
    })

    logger.info('MissAV 影片演员核对完成', avNumber, matchedActors.length)

    /*
     * ================================================================================
     * 步骤3：解析并缓存演员页头像
     * ================================================================================
     * 目标：把演员页 Open Graph 图片加入播放器现有头像回退链。
     * 数据源：已精确匹配的 MissAV 演员页。
     * 操作：
     * 1) 并行请求演员页并复核页面姓名
     * 2) 保存完整头像映射，失败项继续显示默认头像
     */
    logger.info('开始加载 MissAV 演员页头像', avNumber)

    const loadedActors = await Promise.all(matchedActors.map(async ({ actor, expectedKey, expectedName }) => {
      try {
        const response = await this.request.get(actor.url!, { redirect: 'follow' })
        if (!response.ok)
          return null
        const actorWithFace = this.parseActorFace(await response.text(), actor, expectedName)
        if (!actorWithFace?.face)
          return null
        await performerFaceCache.setByName(expectedKey, {
          actor: actorWithFace,
          source: this.source,
        })
        return actorWithFace
      }
      catch (error) {
        logger.warn('MissAV 演员页头像加载失败', actor.name, error)
        return null
      }
    }))
    result.push(...loadedActors.filter((actor): actor is NonNullable<typeof actor> => Boolean(actor?.face)))

    /** 3.1 番号页短名或旧链接无头像时，用完整姓名搜索唯一演员卡片。 */
    const resolvedKeys = new Set(result.map(actor => normalizeActorName(actor.name)))
    const unresolvedNames = missingNames.filter(([expectedKey]) => !resolvedKeys.has(expectedKey))
    const searchedActors = await Promise.all(unresolvedNames.map(async ([expectedKey, expectedName]) => {
      const searchUrl = new URL(`/search/${encodeURIComponent(expectedName)}`, this.baseUrl).href
      try {
        const response = await this.request.get(searchUrl, { redirect: 'follow' })
        if (!response.ok)
          return null
        const actorWithFace = this.parseActorSearchFace(await response.text(), expectedName, searchUrl)
        if (!actorWithFace?.face)
          return null
        await performerFaceCache.setByName(expectedKey, {
          actor: actorWithFace,
          source: this.source,
        })
        return actorWithFace
      }
      catch (error) {
        logger.warn('MissAV 演员搜索头像加载失败', expectedName, error)
        return null
      }
    }))
    result.push(...searchedActors.filter((actor): actor is NonNullable<typeof actor> => Boolean(actor?.face)))

    logger.info('MissAV 演员页头像加载完成', avNumber, result.length)
    return result
  }

  /** 从已匹配的 MissAV 演员页解析头像并复核姓名。 */
  parseActorFace(
    html: string,
    actor: NonNullable<JavInfo['actors']>[number],
    expectedName: string,
  ): NonNullable<JavInfo['actors']>[number] | undefined {
    /*
     * ================================================================================
     * 步骤1：核对演员页并读取头像
     * ================================================================================
     * 目标：同名、别名或异常跳转不能把错误头像写入长期缓存。
     * 数据源：演员页标题、规范链接、演员头像节点和 Open Graph 图片。
     * 操作：
     * 1) 核对页面演员名与已匹配链接
     * 2) 只返回非占位头像并升级为 HTTPS
     */
    logger.info('开始解析 MissAV 演员页头像', expectedName)

    const dom = new DOMParser().parseFromString(html, 'text/html')
    const canonical = dom.querySelector('link[rel="canonical"]')?.getAttribute('href')
    const pageUrl = canonical ? new URL(canonical, actor.url).href : actor.url
    const actorUrlName = getActorNameFromUrl(actor.url)
    const pageUrlName = getActorNameFromUrl(pageUrl)
    const pageTitleName = dom.title.split(/出演|主演|\s+-\s+MissAV/i)[0]?.trim() ?? ''
    const expectedKeys = [expectedName, actor.name, actorUrlName]
      .map(normalizeActorName)
      .filter(Boolean)
    const pageKeys = [pageUrlName, pageTitleName]
      .map(normalizeActorName)
      .filter(Boolean)
    const isExactActor = pageKeys.some(name => expectedKeys.includes(name))
    if (!isExactActor) {
      logger.info('MissAV 演员页头像解析完成，姓名不一致', expectedName)
      return undefined
    }

    /** 1.1 当前页面把真实头像放在 /actress/ 图片节点；Open Graph 常是站点 Logo。 */
    const faceImage = dom.querySelector(
      'img[src*="/actress/"], img[data-src*="/actress/"], img[data-original*="/actress/"]',
    )
    const invalidFacePattern = /nowprinting|no[-_]?image|placeholder|missav\/logo|logo[-_]?square/i
    const rawFace = [
      faceImage?.getAttribute('src'),
      faceImage?.getAttribute('data-src'),
      faceImage?.getAttribute('data-original'),
      dom.querySelector('meta[property="og:image"], meta[name="twitter:image"]')
        ?.getAttribute('content'),
    ].map(value => value?.trim()).find(value => value && !invalidFacePattern.test(value))
    if (!rawFace) {
      logger.info('MissAV 演员页头像解析完成，无有效头像', expectedName)
      return undefined
    }
    const faceUrl = new URL(rawFace, pageUrl).href.replace(/^http:/i, 'https:')
    const result = {
      ...actor,
      name: expectedName,
      url: pageUrl,
      face: faceUrl,
      faceReferer: pageUrl,
    }

    logger.info('MissAV 演员页头像解析完成', expectedName, faceUrl)
    return result
  }

  /** 从完整姓名搜索页读取唯一演员卡片头像。 */
  parseActorSearchFace(
    html: string,
    expectedName: string,
    searchUrl: string,
  ): NonNullable<JavInfo['actors']>[number] | undefined {
    /*
     * ================================================================================
     * 步骤1：合并并核对 MissAV 演员搜索卡片
     * ================================================================================
     * 目标：番号页演员短名失效时，仍能按完整姓名找到真实头像且不猜多结果。
     * 数据源：MissAV 搜索页中同一演员卡片的文字链接和图片链接。
     * 操作：
     * 1) 按演员 URL 合并姓名与头像
     * 2) 只接受唯一且姓名主干一致的候选
     */
    logger.info('开始解析 MissAV 演员搜索头像', expectedName)

    /** 1.1 同一卡片的头像和姓名使用两个链接，先按绝对 URL 合并。 */
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const actors = new Map<string, { name?: string, face?: string }>()
    dom.querySelectorAll('a[href*="/actresses/"]').forEach((anchor) => {
      const url = this.resolveActorUrl(anchor.getAttribute('href'))
      if (!url || /\/actresses\/ranking(?:[/?#]|$)/i.test(url))
        return
      const previous = actors.get(url) ?? {}
      const rawName = anchor.textContent?.trim().replace(/\s+\d+\s*(?:条|條)\s*影片.*$/u, '')
      const image = anchor.querySelector('img')
      const rawFace = [
        image?.getAttribute('src'),
        image?.getAttribute('data-src'),
        image?.getAttribute('data-original'),
      ].map(value => value?.trim()).find(Boolean)
      actors.set(url, {
        name: rawName || previous.name,
        face: rawFace || previous.face,
      })
    })

    /** 1.2 搜索自身已经限定完整姓名；仍要求唯一结果和至少两个字符的共同主干。 */
    const candidates = Array.from(actors, ([url, actor]) => ({ url, ...actor }))
      .filter(actor => actor.name && actor.face)
      .filter(actor => hasCompatibleActorStem(expectedName, actor.name!))
    if (candidates.length !== 1) {
      logger.info('MissAV 演员搜索头像解析完成，候选不唯一', expectedName, candidates.length)
      return undefined
    }

    const candidate = candidates[0]
    const faceUrl = new URL(candidate.face!, searchUrl).href.replace(/^http:/i, 'https:')
    const result = {
      name: expectedName,
      url: candidate.url,
      face: faceUrl,
      faceReferer: searchUrl,
      sex: 1 as const,
    }
    logger.info('MissAV 演员搜索头像解析完成', expectedName, faceUrl)
    return result
  }

  parseStudio(): JavInfo['studio'] {
    return undefined
  }

  parsePublisher(): JavInfo['publisher'] {
    const publisher
      = this.labels['发行商']?.parentElement?.querySelectorAll('a')
    return publisher?.length
      ? Array.from(publisher).map(i => ({
          name: i.textContent!,
          url: i.getAttribute('href') ?? undefined,
        }))
      : undefined
  }

  parseCover(dom: Document): JavInfo['cover'] {
    const cover = dom
      .querySelector('meta[property=\'og:image\']')
      ?.getAttribute('content')

    return cover
      ? {
          url: cover,
          referer: this.detailUrl,
        }
      : undefined
  }

  parseCoverSingle(dom: Document): JavInfo['coverSingle'] {
    /*
     * ================================================================================
     * 步骤1：解析 MissAV 单页封面
     * ================================================================================
     * 目标：优先使用 cover-n 竖版资源，站点格式变化时至少保留有效封面。
     * 数据源：详情页 og:image。
     * 操作：
     * 1) 读取 Open Graph 封面
     * 2) 把 cover-t 文件名映射为 cover-n
     */
    logger.info('开始解析 MissAV 单页封面')

    const cover = dom
      .querySelector('meta[property=\'og:image\']')
      ?.getAttribute('content')
    if (!cover) {
      logger.info('MissAV 单页封面解析完成，无封面')
      return undefined
    }

    const url = new URL(cover, this.baseUrl).href.replace(
      /cover-t(\.[a-z0-9]+)(?:\?.*)?$/i,
      'cover-n$1',
    )
    logger.info('MissAV 单页封面解析完成', url)
    return { url, referer: this.detailUrl }
  }

  parsePreview(): JavInfo['preview'] {
    return undefined
  }

  parseSeries(): JavInfo['series'] {
    const series = this.labels['标籤']?.parentElement?.querySelectorAll('a')
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

  parseCategory(): JavInfo['category'] {
    const categories = this.labels['类型']?.parentElement?.querySelectorAll('a')
    return categories?.length
      ? Array.from(categories).map(i => ({
          name: i.textContent!,
          url: i.getAttribute('href') ?? undefined,
        }))
      : undefined
  }

  parseComments(): JavInfo['comments'] {
    return undefined
  }

  /** 读取当前 MissAV 页面最稳定的标题元数据。 */
  private getPageTitle(dom: Document): string {
    return dom.querySelector('meta[property=\'og:title\']')?.getAttribute('content')?.trim()
      || dom.title.trim()
  }

  /** 把演员页相对地址标准化为绝对地址。 */
  private resolveActorUrl(href?: string | null): string | undefined {
    return href ? new URL(href, this.baseUrl).href : undefined
  }
}

/** 同一影片内兼容来源省略姓氏，但拒绝单字和中间片段。 */
function isCompatibleActorAlias(expectedName: string, candidateName: string) {
  if (!expectedName || !candidateName || expectedName === candidateName)
    return false
  const shorter = expectedName.length <= candidateName.length ? expectedName : candidateName
  const longer = expectedName.length > candidateName.length ? expectedName : candidateName
  return Array.from(shorter).length >= 2
    && (longer.startsWith(shorter) || longer.endsWith(shorter))
}

/** 判断站内搜索结果是否与完整姓名共享稳定的前缀或后缀。 */
function hasCompatibleActorStem(expectedName: string, candidateName: string) {
  const expected = Array.from(normalizeActorName(expectedName))
  const candidate = Array.from(normalizeActorName(candidateName))
  let prefixLength = 0
  while (expected[prefixLength] && expected[prefixLength] === candidate[prefixLength])
    prefixLength += 1
  let suffixLength = 0
  while (
    expected[expected.length - 1 - suffixLength]
    && expected[expected.length - 1 - suffixLength] === candidate[candidate.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }
  return Math.max(prefixLength, suffixLength) >= 2
}
