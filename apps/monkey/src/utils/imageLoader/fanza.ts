import type { ImageLoader } from '@115master/ui'
import type { GMImageCandidate } from './gm'
import type { JavInfo } from '@/utils/jav/jav'
import { javCache } from '@/utils/cache/javCache'
import {
  isSameAvNumber,
  JAV_SOURCE,
  normalizeAvNumber,
} from '@/utils/jav/jav'
import { appLogger } from '@/utils/logger'
import { GMRequest } from '@/utils/request/gmRequest'
import { createGMImageFallbackLoader } from './gm'

interface PackageImage {
  largeUrl?: string | null
  mediumUrl?: string | null
}

interface FanzaContent {
  id?: string | null
  title?: string | null
  packageImage?: PackageImage | null
}

interface FanzaResponse {
  data?: {
    legacySearchPPV?: {
      result?: {
        contents?: FanzaContent[] | null
      } | null
    } | null
  }
}

interface FanzaProduct {
  id: string
  title: string
  images: string[]
}

export interface FanzaCoverLoaderOptions {
  avNumber: string
  title?: string
  fallbacks: GMImageCandidate[]
}

export interface FanzaPreviewLoaderOptions {
  avNumber: string
  title?: string
  index: number
  fallbacks: GMImageCandidate[]
}

const GRAPHQL_URL = 'https://api.video.dmm.co.jp/graphql'
const REFERER = 'https://video.dmm.co.jp/'
const CACHE_VERSION = 1
const MIN_MONO_BYTES = 3000
const MIN_MONO_ASPECT_RATIO = 1.1
const MIN_PREVIEW_BYTES = 5000
const MIN_PREVIEW_ASPECT_RATIO = 1.1
const QUERY = `query FanzaCover($word: String!) {
  legacySearchPPV(
    limit: 10
    sort: SALES_RANK_SCORE
    queryWord: $word
    includeExplicit: true
  ) {
    result {
      contents {
        id
        title
        packageImage {
          largeUrl
          mediumUrl
        }
      }
    }
  }
}`
const gm = new GMRequest()
const logger = appLogger.sub('FanzaCover')
const previewRequests = new Map<string, Promise<FanzaProduct | undefined>>()

function abort(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason ?? new DOMException('请求已取消', 'AbortError')
}

function parts(avNumber: string) {
  const match = normalizeAvNumber(avNumber).match(/^([A-Z]+)(\d+)$/)
  if (!match)
    return undefined
  return {
    prefix: match[1]!,
    number: match[2]!.replace(/^0+(?=\d)/, ''),
  }
}

function suffixPattern(avNumber: string) {
  const value = parts(avNumber)
  if (!value)
    return undefined
  return new RegExp(`${value.prefix}0*${value.number}$`, 'i')
}

function isProductForAvNumber(avNumber: string, id?: string | null) {
  const pattern = suffixPattern(avNumber)
  return Boolean(id && pattern?.test(id))
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function directIds(avNumber: string) {
  const value = parts(avNumber)
  if (!value)
    return []
  return [`${value.prefix.toLowerCase()}${value.number}`]
}

function productIds(avNumber: string, id: string) {
  const pattern = suffixPattern(avNumber)
  const suffix = pattern ? id.match(pattern)?.[0] : undefined
  return unique([id.toLowerCase(), suffix?.toLowerCase()])
}

function monoCandidates(ids: string[]): GMImageCandidate[] {
  return ids.flatMap(id => [
    `https://pics.dmm.co.jp/mono/movie/${id}/${id}pl.jpg`,
    `https://pics.dmm.co.jp/mono/movie/adult/${id}/${id}pl.jpg`,
  ]).map(url => ({
    url,
    referer: REFERER,
    minBytes: MIN_MONO_BYTES,
    minAspectRatio: MIN_MONO_ASPECT_RATIO,
  }))
}

function digitalCandidates(product: FanzaProduct): GMImageCandidate[] {
  return product.images.map(url => ({
    url,
    referer: REFERER,
    minBytes: MIN_MONO_BYTES,
  }))
}

function previewCandidates(
  avNumber: string,
  product: FanzaProduct,
  index: number,
): GMImageCandidate[] {
  return productIds(avNumber, product.id).flatMap(id => [
    `https://pics.dmm.co.jp/digital/video/${id}/${id}jp-${index + 1}.jpg`,
    `https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/${id}/${id}jp-${index + 1}.jpg`,
  ]).map(url => ({
    url,
    referer: REFERER,
    minBytes: MIN_PREVIEW_BYTES,
    minAspectRatio: MIN_PREVIEW_ASPECT_RATIO,
  }))
}

function productFromInfo(avNumber: string, info?: JavInfo): FanzaProduct | undefined {
  if (!info || info.source !== JAV_SOURCE.FANZA || !isSameAvNumber(avNumber, info.avNumber))
    return undefined
  const id = new URL(info.detailUrl).searchParams.get('id')
  const images = unique([info.cover?.url, info.coverSingle?.url])
  if (!id || !isProductForAvNumber(avNumber, id) || !images.length)
    return undefined
  return { id, title: info.title ?? '', images }
}

async function readCache(avNumber: string) {
  const hit = await javCache.get(`${JAV_SOURCE.FANZA}:${normalizeAvNumber(avNumber)}`)
  return productFromInfo(avNumber, hit?.value)
}

async function writeCache(avNumber: string, product: FanzaProduct) {
  const info: JavInfo = {
    source: JAV_SOURCE.FANZA,
    baseUrl: REFERER,
    detailUrl: `${REFERER}av/content/?id=${encodeURIComponent(product.id)}`,
    searchUrl: `${REFERER}list/?keyword=${encodeURIComponent(avNumber)}`,
    avNumber,
    title: product.title,
    cover: { url: product.images[0]!, referer: REFERER },
    coverSingle: product.images[1]
      ? { url: product.images[1], referer: REFERER }
      : undefined,
  }
  await javCache.set(`${JAV_SOURCE.FANZA}:${normalizeAvNumber(avNumber)}`, info)
}

async function query(word: string, signal: AbortSignal): Promise<FanzaContent[]> {
  abort(signal)
  const response = await gm.request(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Referer': REFERER,
    },
    body: JSON.stringify({ query: QUERY, variables: { word } }),
    responseType: 'text',
    signal,
    timeout: 8000,
  })
  if (!response.ok)
    throw new Error(`FANZA 封面查询失败: HTTP ${response.status}`)
  const value = JSON.parse(await response.text()) as FanzaResponse
  abort(signal)
  return value.data?.legacySearchPPV?.result?.contents ?? []
}

function matchProduct(avNumber: string, contents: FanzaContent[]): FanzaProduct | undefined {
  const content = contents.find(item => isProductForAvNumber(avNumber, item.id))
  const images = unique([
    content?.packageImage?.largeUrl,
    content?.packageImage?.mediumUrl,
  ])
  if (!content?.id || !images.length)
    return undefined
  return {
    id: content.id,
    title: content.title ?? '',
    images,
  }
}

async function findProduct(
  avNumber: string,
  title: string | undefined,
  signal: AbortSignal,
): Promise<FanzaProduct | undefined> {
  /*
   * ================================================================================
   * 步骤1：查询并缓存 FANZA 商品
   * ================================================================================
   * 目标：取得官方商品 ID 和数字封面，不把相似番号当作当前影片。
   * 数据源：FANZA 缓存、番号搜索和当前详情标题搜索。
   * 操作：
   * 1) 优先读取精确番号缓存
   * 2) 番号无结果时用现有详情标题回查
   * 3) 商品 ID 尾部精确匹配后写入缓存
   */
  logger.info('开始查询 FANZA 商品', avNumber)

  /** 1.1 已缓存的商品不再访问 GraphQL。 */
  const cached = await readCache(avNumber)
  abort(signal)
  if (cached) {
    logger.info('FANZA 商品查询完成，命中缓存', avNumber)
    return cached
  }

  /** 1.2 先查番号；没有精确商品时才使用其他来源返回的标题。 */
  const byNumber = matchProduct(avNumber, await query(avNumber, signal))
  const product = byNumber ?? (title?.trim()
    ? matchProduct(avNumber, await query(title.trim(), signal))
    : undefined)
  abort(signal)
  if (product)
    await writeCache(avNumber, product)
  abort(signal)

  logger.info('FANZA 商品查询完成', avNumber, product?.id ?? '')
  return product
}

function waitForProduct(
  pending: Promise<FanzaProduct | undefined>,
  signal: AbortSignal,
) {
  abort(signal)
  return new Promise<FanzaProduct | undefined>((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? new DOMException('请求已取消', 'AbortError'))
    const cleanup = () => signal.removeEventListener('abort', cancel)
    signal.addEventListener('abort', cancel, { once: true })
    pending.then(
      (product) => {
        cleanup()
        resolve(product)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

async function findPreviewProduct(
  avNumber: string,
  title: string | undefined,
  signal: AbortSignal,
) {
  /*
   * ================================================================================
   * 步骤1：共享播放器官方剧照商品查询
   * ================================================================================
   * 目标：同一影片的多张剧照只查询一次 FANZA，同时让单张图片取消立即返回。
   * 数据源：FANZA 商品缓存、番号和当前详情标题。
   * 操作：
   * 1) 优先读取已缓存商品
   * 2) 复用同番号进行中的查询
   * 3) 调用方取消时停止等待，不中断其他剧照
   */
  logger.info('开始共享播放器官方剧照商品查询', avNumber)

  /** 1.1 封面链已写入的商品可以直接复用。 */
  const cached = await readCache(avNumber)
  abort(signal)
  if (cached) {
    logger.info('播放器官方剧照商品查询完成，命中缓存', avNumber)
    return cached
  }

  /** 1.2 并发剧照共用独立查询，任意一张卸载不会取消其余图片。 */
  const key = JSON.stringify([normalizeAvNumber(avNumber), title?.trim()])
  const existing = previewRequests.get(key)
  const pending = existing ?? findProduct(
    avNumber,
    title,
    new AbortController().signal,
  ).finally(() => previewRequests.delete(key))
  if (!existing)
    previewRequests.set(key, pending)

  /** 1.3 当前图片取消后立即结束等待，共享查询仍可供其他图片和缓存使用。 */
  const product = await waitForProduct(pending, signal)
  logger.info('播放器官方剧照商品查询完成', avNumber, product?.id ?? '')
  return product
}

async function tryCandidates(candidates: GMImageCandidate[], signal: AbortSignal) {
  if (!candidates.length)
    return undefined
  try {
    return await createGMImageFallbackLoader(candidates).load(candidates[0]!.url, signal)
  }
  catch (error) {
    if (signal.aborted)
      throw error
    return undefined
  }
}

/** 创建 DMM 实体横封套、FANZA 数字封面和现有资料源的三级加载链。 */
export function createFanzaCoverLoader(options: FanzaCoverLoaderOptions): ImageLoader {
  const direct = monoCandidates(directIds(options.avNumber)).slice(0, 1)
  const key = JSON.stringify([
    CACHE_VERSION,
    normalizeAvNumber(options.avNumber),
    options.title?.trim(),
    options.fallbacks,
  ])

  return {
    key,
    async load(_url, signal) {
      /*
       * ================================================================================
       * 步骤1：按官方优先级加载封面
       * ================================================================================
       * 目标：优先显示实体 DVD 横封套；实体图不存在时使用官方数字封面。
       * 数据源：DMM mono、FANZA GraphQL 和原有 Jav 资料源封面。
       * 操作：
       * 1) 先尝试可由番号直接推导的实体横封套
       * 2) 查询商品 ID 后补试实体图并回退官方数字图
       * 3) 官方链失败后继续原有封面候选
       */
      logger.info('开始加载 FANZA 官方封面', options.avNumber)

      /** 1.1 有效实体图直接返回，不产生 GraphQL 请求。 */
      const directCover = await tryCandidates(direct, signal)
      if (directCover) {
        logger.info('FANZA 官方封面加载完成，命中实体图', options.avNumber)
        return directCover
      }

      /** 1.2 商品查询失败不阻断现有 JavLibrary/JavBus/JavDB/MissAV 封面。 */
      const product = await findProduct(options.avNumber, options.title, signal).catch((error) => {
        if (signal.aborted)
          throw error
        logger.warn('FANZA 官方封面加载失败，继续现有来源', options.avNumber, error)
        return undefined
      })

      /** 1.3 商品 ID 可补齐带厂商前缀的实体横封套地址。 */
      if (product) {
        const directUrls = new Set(direct.map(candidate => candidate.url))
        const productMono = monoCandidates(productIds(options.avNumber, product.id))
          .filter(candidate => !directUrls.has(candidate.url))
        const monoCover = await tryCandidates(productMono, signal)
        if (monoCover) {
          logger.info('FANZA 官方封面加载完成，命中商品实体图', options.avNumber)
          return monoCover
        }
      }

      /** 1.4 其他资料源存在真实横封套时，优先于 FANZA 数字竖图。 */
      const wideCover = await tryCandidates(
        options.fallbacks.map(candidate => ({
          ...candidate,
          minAspectRatio: MIN_MONO_ASPECT_RATIO,
        })),
        signal,
      )
      if (wideCover) {
        logger.info('FANZA 官方封面加载完成，命中现有横封套', options.avNumber)
        return wideCover
      }

      /** 1.5 没有任何横封套时，才使用 FANZA 官方数字图。 */
      if (product) {
        const digitalCover = await tryCandidates(digitalCandidates(product), signal)
        if (digitalCover) {
          logger.info('FANZA 官方封面加载完成，命中数字图', options.avNumber)
          return digitalCover
        }
      }

      /** 1.6 官方来源无结果时保持原有封面回退顺序。 */
      const fallback = await createGMImageFallbackLoader(options.fallbacks)
        .load(options.fallbacks[0]?.url ?? '', signal)
      logger.info('FANZA 官方封面加载完成，使用现有来源', options.avNumber)
      return fallback
    },
  }
}

/** 创建 FANZA/DMM 官方高清剧照与现有资料源的加载链。 */
export function createFanzaPreviewLoader(options: FanzaPreviewLoaderOptions): ImageLoader {
  const key = JSON.stringify([
    CACHE_VERSION,
    'preview',
    normalizeAvNumber(options.avNumber),
    options.title?.trim(),
    options.index,
    options.fallbacks,
  ])

  return {
    key,
    async load(_url, signal) {
      /*
       * ================================================================================
       * 步骤1：加载播放器高清剧照
       * ================================================================================
       * 目标：优先显示 FANZA/DMM 官方原尺寸剧照，缺失时保持现有资料源回退。
       * 数据源：FANZA 商品 ID、当前剧照序号和跨来源剧照候选。
       * 操作：
       * 1) 查询精确商品并尝试官方剧照
       * 2) 官方图缺失后继续原图、缩略图和跨来源候选
       */
      logger.info('开始加载播放器高清剧照', options.avNumber, options.index)

      /** 1.1 商品查询或官方图片失败不能阻断已有 Jav 来源。 */
      const product = await findPreviewProduct(
        options.avNumber,
        options.title,
        signal,
      ).catch((error) => {
        if (signal.aborted)
          throw error
        logger.warn('播放器官方剧照查询失败，继续现有来源', options.avNumber, error)
        return undefined
      })
      if (product) {
        const official = await tryCandidates(
          previewCandidates(options.avNumber, product, options.index),
          signal,
        )
        if (official) {
          logger.info('播放器高清剧照加载完成，命中官方图片', options.avNumber, options.index)
          return official
        }
      }

      /** 1.2 保留当前详情和其他资料源的原图、缩略图回退。 */
      const fallback = await createGMImageFallbackLoader(options.fallbacks, {
        timeoutMs: 3000,
        transform: false,
      }).load(options.fallbacks[0]?.url ?? '', signal)
      logger.info('播放器高清剧照加载完成，使用现有来源', options.avNumber, options.index)
      return fallback
    },
  }
}

export { isProductForAvNumber }
