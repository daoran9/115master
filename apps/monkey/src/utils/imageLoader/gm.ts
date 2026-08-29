import type { ImageLoader, ImageResource } from '@115master/ui'
import { image as imageUtil } from '@115master/utils'
import { imageCache } from '@/utils/cache/imageCache'
import { appLogger } from '@/utils/logger'
import { GMRequest } from '@/utils/request/gmRequest'

interface TransformOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  type?: string
}

interface GMImageLoaderOptions {
  referer?: string
  cache?: boolean
  maxAge?: number
  timeoutMs?: number
  minBytes?: number
  minAspectRatio?: number
  transform?: TransformOptions | false
  cookiePartition?: {
    topLevelSite?: string
  }
}

export interface GMImageCandidate {
  url: string
  referer?: string
  minBytes?: number
  minAspectRatio?: number
  cookiePartition?: {
    topLevelSite?: string
  }
}

const CACHE_VERSION = 2
const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60 * 1000
const DEFAULT_REQUEST_TIMEOUT_MS = 5000
const DEFAULT_TRANSFORM: TransformOptions = {
  maxWidth: 720,
  maxHeight: 720,
  quality: 0.8,
  type: 'image/webp',
}
const gm = new GMRequest()
const logger = appLogger.sub('GMImageLoader')

function abort(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason ?? new DOMException('请求已取消', 'AbortError')
}

function requestWithTimeout<T>(
  signal: AbortSignal,
  timeoutMs: number,
  request: (requestSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  abort(signal)
  const controller = new AbortController()

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      fail(new DOMException(`图片请求超过 ${timeoutMs}ms`, 'TimeoutError'), true)
    }, timeoutMs)

    function cleanup() {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
    }

    function succeed(value: T) {
      if (settled)
        return
      settled = true
      cleanup()
      resolve(value)
    }

    function fail(error: unknown, cancelRequest = false) {
      if (settled)
        return
      settled = true
      if (cancelRequest)
        controller.abort(error)
      cleanup()
      reject(error)
    }

    function handleAbort() {
      fail(signal.reason ?? new DOMException('请求已取消', 'AbortError'), true)
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    Promise.resolve()
      .then(() => request(controller.signal))
      .then(succeed, fail)
  })
}

function resource(blob: Blob): ImageResource {
  const src = URL.createObjectURL(blob)
  return {
    src,
    dispose: () => URL.revokeObjectURL(src),
  }
}

async function validateImage(
  blob: Blob,
  signal: AbortSignal,
  options: Pick<GMImageLoaderOptions, 'minBytes' | 'minAspectRatio'>,
) {
  /*
   * ================================================================================
   * 步骤1：校验远程图片内容
   * ================================================================================
   * 目标：在压缩和缓存前拒绝 DMM 占位图及不符合版式的图片。
   * 数据源：GM 请求取得的原始 Blob 和候选图片约束。
   * 操作：
   * 1) 核对最小体积
   * 2) 解码图片并核对最小宽高比
   */
  logger.info('开始校验远程图片内容', blob.size)

  // 1.1 小于来源约定体积的图片不能进入缓存。
  if (options.minBytes !== undefined && blob.size < options.minBytes)
    throw new Error(`图片体积过小: ${blob.size}B`)
  if (options.minAspectRatio === undefined) {
    logger.info('远程图片内容校验完成', blob.size)
    return
  }

  /** 1.2 宽高比不满足横封套要求时关闭解码资源并回退下一来源。 */
  const bitmap = await createImageBitmap(blob)
  try {
    abort(signal)
    const ratio = bitmap.height > 0 ? bitmap.width / bitmap.height : 0
    if (ratio < options.minAspectRatio)
      throw new Error(`图片宽高比无效: ${bitmap.width}x${bitmap.height}`)
  }
  finally {
    bitmap.close()
  }

  logger.info('远程图片内容校验完成', blob.size)
}

export function createGMImageLoader(options: GMImageLoaderOptions): ImageLoader {
  const cache = options.cache ?? true
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const transform = options.transform === false ? false : { ...DEFAULT_TRANSFORM, ...options.transform }
  const key = JSON.stringify([
    CACHE_VERSION,
    options.referer,
    options.cookiePartition,
    cache,
    maxAge,
    timeoutMs,
    options.minBytes,
    options.minAspectRatio,
    transform,
  ])

  return {
    key,
    async load(url, signal) {
      const cacheKey = `gm-image:${JSON.stringify([key, url])}`
      if (cache) {
        const hit = await imageCache.get(cacheKey)
        abort(signal)
        if (hit && Date.now() - hit.updatedAt <= maxAge)
          return resource(hit.value)
        if (hit)
          await imageCache.remove(cacheKey)
      }

      const response = await requestWithTimeout(signal, timeoutMs, requestSignal => gm.get(url, {
        headers: options.referer ? { Referer: options.referer } : {},
        responseType: 'blob',
        signal: requestSignal,
        timeout: timeoutMs,
        cookiePartition: options.cookiePartition,
      }))
      if (!response.ok)
        throw new Error(`图片请求失败: HTTP ${response.status}`)

      const original = await response.blob()
      abort(signal)
      if (original.type && !original.type.startsWith('image/'))
        throw new Error(`图片响应类型无效: ${original.type}`)
      await validateImage(original, signal, options)
      abort(signal)

      const blob = transform ? await imageUtil.compress(original, transform) : original
      abort(signal)
      if (cache)
        await imageCache.set(cacheKey, blob)
      abort(signal)
      return resource(blob)
    },
  }
}

/** 创建按顺序尝试多个来源的 GM 图片加载器。 */
export function createGMImageFallbackLoader(
  candidates: GMImageCandidate[],
  options: Omit<GMImageLoaderOptions, 'referer'> = {},
): ImageLoader {
  /*
   * ================================================================================
   * 步骤1：建立封面后备加载链
   * ================================================================================
   * 目标：主来源图片被防盗链或下线时自动尝试后续资料源。
   * 数据源：融合详情保存的封面 URL 和各自 Referer。
   * 操作：
   * 1) 过滤空 URL 并为每个候选创建独立 GM 加载器
   * 2) 加载失败时按顺序继续，成功后立即返回
   */
  logger.info('开始建立封面后备加载链', candidates.length)

  /** 1.1 候选顺序与资料源优先级一致。 */
  const loaders = candidates
    .filter(candidate => Boolean(candidate.url))
    .map(candidate => ({
      candidate,
      loader: createGMImageLoader({
        ...options,
        referer: candidate.referer ?? '',
        minBytes: candidate.minBytes,
        minAspectRatio: candidate.minAspectRatio,
        cookiePartition: candidate.cookiePartition,
      }),
    }))
  const key = JSON.stringify(loaders.map(({ candidate, loader }) => [candidate, loader.key]))
  logger.info('封面后备加载链建立完成', loaders.length)

  return {
    key,
    async load(_url, signal) {
      logger.info('开始按候选加载封面', loaders.length)
      let lastError: unknown

      for (const { candidate, loader } of loaders) {
        // 1.2 取消状态必须立即向上传递，不能继续产生后备请求。
        abort(signal)
        try {
          const loaded = await loader.load(candidate.url, signal)
          logger.info('候选封面加载完成', candidate.url)
          return loaded
        }
        catch (error) {
          if (signal.aborted)
            throw error
          lastError = error
          logger.warn('候选封面加载失败，继续后备来源', candidate.url, error)
        }
      }

      logger.info('候选封面加载完成，无可用图片')
      throw lastError ?? new Error('没有可用封面')
    },
  }
}
