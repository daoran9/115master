import type { JavInfo } from './jav'
import { javCache } from '@/utils/cache/javCache'
import { appLogger } from '@/utils/logger'
import {
  isJavInfoCacheable,
  isJavInfoForAvNumber,
  Jav,
  normalizeAvNumber,
} from './jav'

const logger = appLogger.sub('JavInfoLoader')
const DEFAULT_HEDGE_DELAY = 1200
const DEFAULT_SOURCE_WAIT_TIMEOUTS = [5000, 4000, 4000, 4000]
const MAX_CONCURRENT_NETWORK_LOADS = 3
const MERGED_CACHE_PREFIX = 'Fusion'
const inFlightLoads = new Map<string, Promise<JavInfo | null>>()
const networkLoadWaiters: Array<(release: () => void) => void> = []
let activeNetworkLoads = 0

export interface JavInfoSource {
  source: string
  getInfoByCache: (avNumber: string) => Promise<JavInfo | undefined>
  getInfo: (avNumber: string) => Promise<JavInfo | undefined>
  cancelInfoRequest?: (avNumber: string) => void
}

interface LoadJavInfoOptions {
  hedgeDelay?: number
  sourceWaitTimeout?: number
}

interface SourceResult {
  info: JavInfo | null
}

interface ScheduledSource {
  promise: Promise<SourceResult>
  cancel: () => void
  getSettledResult: () => SourceResult | undefined
}

/** 汇总全部来源封面并按来源优先级去重。 */
function collectCoverCandidates(infos: JavInfo[]): NonNullable<JavInfo['coverFallbacks']> {
  /*
   * ================================================================================
   * 步骤1：收集封面候选
   * ================================================================================
   * 目标：主来源图片失效时保留同番号后备来源封面。
   * 数据源：各来源的双页、单页和历史融合封面。
   * 操作：
   * 1) 按来源优先级展开候选
   * 2) 按 URL 和 Referer 去重，避免重复请求同一资源
   */
  logger.info('开始收集番号封面候选', infos.length)

  const seen = new Set<string>()
  const candidates = infos
    .flatMap(info => [info.cover, info.coverSingle, ...(info.coverFallbacks ?? [])])
    .filter((cover): cover is NonNullable<JavInfo['cover']> => Boolean(cover?.url))
    .filter((cover) => {
      /** 1.1 同一 URL 使用不同 Referer 时仍保留，防盗链策略可能不同。 */
      const key = `${cover.url}\u0000${cover.referer ?? ''}`
      if (seen.has(key))
        return false
      seen.add(key)
      return true
    })

  logger.info('番号封面候选收集完成', candidates.length)
  return candidates
}

/** 创建只释放一次的网络加载槽回收函数。 */
function createNetworkLoadRelease(): () => void {
  let released = false
  return () => {
    if (released)
      return
    released = true

    const next = networkLoadWaiters.shift()
    if (next) {
      next(createNetworkLoadRelease())
      logger.info('番号资料网络加载槽已转交', activeNetworkLoads, networkLoadWaiters.length)
      return
    }

    activeNetworkLoads -= 1
    logger.info('番号资料网络加载槽已释放', activeNetworkLoads, networkLoadWaiters.length)
  }
}

/** 限制同一页面同时执行的番号联网任务，缓存读取不受此限制。 */
function acquireNetworkLoadSlot(): Promise<() => void> {
  if (activeNetworkLoads < MAX_CONCURRENT_NETWORK_LOADS) {
    activeNetworkLoads += 1
    logger.info('番号资料网络加载槽已取得', activeNetworkLoads, networkLoadWaiters.length)
    return Promise.resolve(createNetworkLoadRelease())
  }

  logger.info('番号资料网络加载等待空闲槽', activeNetworkLoads, networkLoadWaiters.length + 1)
  return new Promise(resolve => networkLoadWaiters.push(resolve))
}

/** 保留高优先级来源已有字段，只从后续来源填充缺项。 */
function mergeJavInfo(
  avNumber: string,
  infos: Array<JavInfo | null | undefined>,
): JavInfo | null {
  const validInfos = infos.filter(
    (info): info is JavInfo => Boolean(info) && isJavInfoForAvNumber(avNumber, info),
  )
  const [primary, ...fallbacks] = validInfos
  if (!primary)
    return null

  const mergedInfo = fallbacks.reduce<JavInfo>((current, fallback) => ({
    ...current,
    avNumber: current.avNumber || fallback.avNumber,
    title: current.title || fallback.title,
    date: current.date || fallback.date,
    duration: current.duration || fallback.duration,
    director: current.director?.length ? current.director : fallback.director,
    actors: current.actors?.length ? current.actors : fallback.actors,
    studio: current.studio?.length ? current.studio : fallback.studio,
    publisher: current.publisher?.length ? current.publisher : fallback.publisher,
    cover: current.cover || fallback.cover || current.coverSingle || fallback.coverSingle,
    coverSingle: current.coverSingle || fallback.coverSingle || current.cover || fallback.cover,
    preview: current.preview?.length ? current.preview : fallback.preview,
    series: current.series?.length ? current.series : fallback.series,
    category: current.category?.length ? current.category : fallback.category,
    score: current.score ?? fallback.score,
    scoreCount: current.scoreCount ?? fallback.scoreCount,
    viewCount: current.viewCount ?? fallback.viewCount,
    downloadCount: current.downloadCount ?? fallback.downloadCount,
    comments: current.comments?.length ? current.comments : fallback.comments,
  }), primary)
  const coverCandidates = collectCoverCandidates(validInfos)
  return {
    ...mergedInfo,
    cover: coverCandidates[0] ?? mergedInfo.cover,
    coverSingle: mergedInfo.coverSingle ?? coverCandidates[1] ?? coverCandidates[0],
    coverFallbacks: coverCandidates.slice(1),
  }
}

/** 判断融合详情是否足以恢复页面已显示的主要内容。 */
function isJavInfoDisplayable(avNumber: string, info: JavInfo | null): info is JavInfo {
  return isJavInfoCacheable(info, avNumber)
}

/** 只缓存番号精确且足以恢复页面显示的融合详情。 */
async function cacheMergedInfo(avNumber: string, info: JavInfo | null) {
  if (!isJavInfoDisplayable(avNumber, info))
    return
  await javCache.set(`${MERGED_CACHE_PREFIX}:${avNumber}`, info)
}

/** 请求单个资料源，并把可回退错误转换为空结果。 */
async function requestSource(source: JavInfoSource, avNumber: string): Promise<SourceResult> {
  try {
    const info = await source.getInfo(avNumber) ?? null
    if (info && !isJavInfoForAvNumber(avNumber, info)) {
      logger.warn('番号资料源返回相似番号，继续回退', source.source, avNumber, info.avNumber)
      return { info: null }
    }
    return {
      info,
    }
  }
  catch (error) {
    if (!(error instanceof Jav.NotFound))
      logger.warn('番号资料源加载失败，继续回退', source.source, error)
    return { info: null }
  }
}

/** 按延迟启动来源；高优先级命中时可取消尚未开始的后备请求。 */
function scheduleSource(
  source: JavInfoSource,
  avNumber: string,
  delay: number,
): ScheduledSource {
  let started = false
  let settledResult: SourceResult | undefined
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined
  let resolvePromise = undefined as unknown as (result: SourceResult) => void
  const promise = new Promise<SourceResult>((resolve) => {
    resolvePromise = resolve
    const start = () => {
      started = true
      timer = undefined
      requestSource(source, avNumber).then((result) => {
        settledResult = result
        resolve(result)
      })
    }
    if (delay === 0)
      start()
    else
      timer = globalThis.setTimeout(start, delay)
  })

  return {
    promise,
    cancel: () => {
      if (settledResult)
        return
      source.cancelInfoRequest?.(avNumber)
      if (started)
        return
      if (timer !== undefined)
        globalThis.clearTimeout(timer)
      timer = undefined
      settledResult = { info: null }
      resolvePromise(settledResult)
    },
    getSettledResult: () => settledResult,
  }
}

/** 等待单个来源到达期限；超时不改变该来源最终 Promise 的状态。 */
async function waitForScheduledSource(
  scheduledSource: ScheduledSource,
  timeout: number,
): Promise<SourceResult | undefined> {
  if (scheduledSource.getSettledResult())
    return scheduledSource.getSettledResult()

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
  const timeoutResult = new Promise<undefined>((resolve) => {
    timeoutId = globalThis.setTimeout(() => resolve(undefined), timeout)
  })
  const result = await Promise.race([scheduledSource.promise, timeoutResult])
  if (timeoutId !== undefined)
    globalThis.clearTimeout(timeoutId)
  return result
}

/**
 * 按优先级加载番号资料。
 *
 * 缓存并行读取；联网阶段在当前源超过等待阈值后提前启动下一源，
 * 但必须等高优先级源确定无结果后才采用低优先级结果。
 */
export function loadJavInfo(
  avNumber: string,
  sources: JavInfoSource[],
  options: LoadJavInfoOptions = {},
): Promise<JavInfo | null> {
  const requestedAvNumber = avNumber.trim().toUpperCase()
  const lookupKey = normalizeAvNumber(requestedAvNumber)
  if (!lookupKey)
    return Promise.resolve(null)
  const activeLoad = inFlightLoads.get(lookupKey)
  if (activeLoad)
    return activeLoad

  /*
   * ================================================================================
   * 步骤1：合并相同番号请求
   * ================================================================================
   * 目标：同一列表出现重复番号时只访问一次外部资料源。
   * 数据源：当前进程内尚未完成的番号加载任务。
   * 操作：
   * 1) 创建唯一加载 Promise
   * 2) 完成后释放任务引用
   */
  logger.info('开始调度番号资料', lookupKey)
  const task = loadJavInfoInternal(
    requestedAvNumber,
    sources,
    options.hedgeDelay ?? DEFAULT_HEDGE_DELAY,
    options.sourceWaitTimeout,
  ).finally(() => {
    if (inFlightLoads.get(lookupKey) === task)
      inFlightLoads.delete(lookupKey)
    logger.info('番号资料调度完成', lookupKey)
  })
  inFlightLoads.set(lookupKey, task)
  return task
}

async function loadJavInfoInternal(
  avNumber: string,
  sources: JavInfoSource[],
  hedgeDelay: number,
  sourceWaitTimeout?: number,
): Promise<JavInfo | null> {
  const mergedCache = await javCache.get(`${MERGED_CACHE_PREFIX}:${avNumber}`)
  const mergedInfo = mergedCache?.value ?? null
  if (isJavInfoDisplayable(avNumber, mergedInfo)) {
    return mergedInfo
  }

  /*
   * ================================================================================
   * 步骤1：并行读取来源缓存
   * ================================================================================
   * 目标：减少四次 IndexedDB 串行等待，同时保持来源优先级。
   * 数据源：JavLibrary、JavBus、JavDB、MissAV 本地缓存。
   * 操作：
   * 1) 同时读取全部缓存
   * 2) 按传入顺序融合可展示结果并直接复用
   */
  logger.info('开始并行读取番号资料缓存', avNumber)
  const cachedResults = await Promise.all(
    sources.map(source => source.getInfoByCache(avNumber)),
  )
  const cachedInfos = cachedResults.map((info, index) => {
    if (!info || isJavInfoForAvNumber(avNumber, info))
      return info
    logger.warn(
      '番号资料缓存返回相似番号，忽略缓存',
      sources[index]?.source,
      avNumber,
      info.avNumber,
    )
    return undefined
  })
  const cachedInfo = mergeJavInfo(avNumber, cachedInfos)
  logger.info('番号资料缓存读取完成', avNumber)
  if (isJavInfoDisplayable(avNumber, cachedInfo)) {
    await cacheMergedInfo(avNumber, cachedInfo)
    return cachedInfo
  }

  /*
   * ================================================================================
   * 步骤2：取得受控联网槽
   * ================================================================================
   * 目标：冷缓存首屏不同时启动几十条跨站请求，避免来源响应整体超时。
   * 数据源：当前页面共享的番号联网任务队列。
   * 操作：
   * 1) 最多允许两个番号同时联网
   * 2) 当前番号完成后把槽位交给下一项
   */
  logger.info('开始等待番号资料网络加载槽', avNumber)
  const releaseNetworkLoad = await acquireNetworkLoadSlot()
  logger.info('番号资料网络加载槽等待完成', avNumber)

  try {
    /*
     * ================================================================================
     * 步骤3：按优先级重叠来源等待
     * ================================================================================
     * 目标：把多来源最坏等待从串行累加缩短为重叠等待。
     * 数据源：按优先级排列的外部资料源。
     * 操作：
     * 1) 当前源等待超过阈值时提前启动下一源
     * 2) 单个来源到达期限后采用已经完成的最高优先级结果
     */
    logger.info('开始按优先级请求番号资料', avNumber)
    const scheduledSources = sources.map((source, index) =>
      scheduleSource(source, avNumber, index * hedgeDelay),
    )
    const results = [...cachedInfos]

    for (let index = 0; index < scheduledSources.length; index += 1) {
      /** 3.1 每个来源只占用有限等待窗口，避免 Cloudflare 或后台队列长期挡住详情。 */
      const result = await waitForScheduledSource(
        scheduledSources[index]!,
        sourceWaitTimeout
        ?? DEFAULT_SOURCE_WAIT_TIMEOUTS[index]
        ?? DEFAULT_SOURCE_WAIT_TIMEOUTS[DEFAULT_SOURCE_WAIT_TIMEOUTS.length - 1]!,
      )
      if (!result) {
        logger.warn('番号资料源等待超时，检查已完成后备来源', sources[index]?.source, avNumber)
        scheduledSources[index]!.cancel()
      }

      /** 3.2 汇总所有已经完成的并行请求，并继续按原来源顺序融合。 */
      scheduledSources.forEach((scheduledSource, sourceIndex) => {
        const settledResult = scheduledSource.getSettledResult()
        if (settledResult?.info)
          results[sourceIndex] = settledResult.info
      })
      const mergedInfo = mergeJavInfo(avNumber, results)
      if (isJavInfoDisplayable(avNumber, mergedInfo)) {
        const primarySourceIndex = results.findIndex(info => isJavInfoForAvNumber(avNumber, info))
        const hasFallbackCover = Boolean(mergedInfo.coverFallbacks?.length)
        const reachedLastSource = index === scheduledSources.length - 1

        /** 3.3 首选源可立即采用；后备源命中时至少等到一张替代封面或全部来源结束。 */
        if (primarySourceIndex === 0 || hasFallbackCover || reachedLastSource) {
          scheduledSources.forEach(source => source.cancel())
          await cacheMergedInfo(avNumber, mergedInfo)
          logger.info('按优先级请求番号资料完成', avNumber, mergedInfo.source)
          return mergedInfo
        }
      }
    }

    scheduledSources.forEach(source => source.cancel())
    logger.info('按优先级请求番号资料完成，无结果', avNumber)
    return mergeJavInfo(avNumber, results)
  }
  finally {
    releaseNetworkLoad()
    logger.info('番号资料网络加载槽释放完成', avNumber)
  }
}
