import type { IRequest } from '@115master/shared'
import type { Ed2kWorkerRequest, Ed2kWorkerResponse } from './protocol'
import { InfraError, Logger } from '@115master/shared'
import Ed2kWorker from './ed2k.worker?worker&inline'
import {
  buildEd2kLink,
  ED2K_PART_SIZE,
  finishEd2kHash,
  hashEd2kPart,
} from './hash'

export interface Ed2kProgress {
  loaded: number
  parts: number
  speed: number
  stage: 'download' | 'finish' | 'hash' | 'link'
  total: number
}

export interface Ed2kBatchMetric {
  addresses: number
  attempts: number
  batch: number
  batches: number
  bytes: number
  downloadMs: number
  hashMs: number
  worker: 'main' | 'worker'
}

export interface Ed2kSource {
  cookie?: string
  name: string
  resolve?: (signal?: AbortSignal) => Promise<Ed2kEndpoint>
  size: number
  url?: string
}

export interface Ed2kEndpoint {
  cookie?: string
  url: string
}

export interface Ed2kOptions {
  onBatch?: (metric: Ed2kBatchMetric) => void
  onProgress?: (progress: Ed2kProgress) => void
  request: IRequest
  signal?: AbortSignal
}

interface Ed2kState {
  addresses: number
  parts: string[]
  started: number
}

interface DownloadedBatch {
  attempts: number
  buffer: ArrayBuffer
  downloadMs: number
}

const logger = new Logger('ED2KCalculate')
const RANGE_CONCURRENCY = 2
export const ED2K_BATCH_PARTS = 4
export const ED2K_BATCH_SIZE = ED2K_PART_SIZE * ED2K_BATCH_PARTS
export const ED2K_NETWORK_RETRIES = 3
const PROGRESS_INTERVAL = 250
const RETRY_DELAY = 500
const WORKER_START_TIMEOUT = 1_500
const WORKER_TASK_TIMEOUT = 30_000

class RangeResponseError extends Error {
  constructor(status: number) {
    super(`服务器不支持 Range 206（HTTP ${status}），已停止读取以避免整文件一次性载入内存`)
    this.name = 'RangeResponseError'
  }
}

class RangeIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RangeIntegrityError'
  }
}

class RangeDownloadError extends Error {
  declare cause: unknown

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'RangeDownloadError'
    this.cause = cause
  }
}

class EndpointResolveError extends Error {
  declare cause: unknown

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'EndpointResolveError'
    this.cause = cause
  }
}

function contentRange(response: Response) {
  const match = response.headers.get('content-range')
    ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i)

  if (!match)
    return

  return {
    end: Number(match[2]),
    start: Number(match[1]),
    total: Number(match[3]),
  }
}

function assertRange(response: Response, start: number, end: number, total: number) {
  if (response.status !== 206)
    throw new RangeResponseError(response.status)

  const range = contentRange(response)
  if (!range || range.start !== start || range.end !== end || range.total !== total)
    throw new RangeIntegrityError('服务器返回的 Content-Range 与请求不一致')
}

interface WorkerSendOptions {
  signal?: AbortSignal
  timeout?: number
  transfer?: Transferable[]
}

function send(
  worker: Worker,
  request: Ed2kWorkerRequest,
  options: WorkerSendOptions = {},
) {
  return new Promise<Ed2kWorkerResponse>((resolve, reject) => {
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined

    function cleanup() {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      worker.removeEventListener('messageerror', handleMessageError)
      options.signal?.removeEventListener('abort', handleAbort)
      if (timer !== undefined)
        globalThis.clearTimeout(timer)
    }

    function fail(cause: unknown) {
      cleanup()
      reject(cause)
    }

    function handleMessage(event: MessageEvent<Ed2kWorkerResponse>) {
      cleanup()
      if (event.data.type === 'error') {
        reject(new Error(event.data.message))
        return
      }
      resolve(event.data)
    }

    function handleError(event: ErrorEvent) {
      fail(event.error ?? new Error(event.message || 'ED2K Worker 加载失败'))
    }

    function handleMessageError() {
      fail(new Error('ED2K Worker 消息无法解析'))
    }

    function handleAbort() {
      fail(options.signal?.reason ?? new DOMException('请求已取消', 'AbortError'))
    }

    if (options.signal?.aborted) {
      handleAbort()
      return
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    worker.addEventListener('messageerror', handleMessageError)
    options.signal?.addEventListener('abort', handleAbort, { once: true })
    if (options.timeout !== undefined) {
      timer = globalThis.setTimeout(
        () => fail(new Error('ED2K Worker 响应超时')),
        options.timeout,
      )
    }

    try {
      worker.postMessage(request, options.transfer ?? [])
    }
    catch (cause) {
      fail(cause)
    }
  })
}

async function startWorker(signal?: AbortSignal) {
  if (import.meta.env.DEV) {
    logger.info('开发服务跨域 Worker 已跳过，使用页面分块计算')
    return null
  }

  const worker = new Ed2kWorker()
  try {
    const response = await send(worker, { type: 'ping' }, {
      signal,
      timeout: WORKER_START_TIMEOUT,
    })
    if (response.type !== 'ready')
      throw new Error('ED2K Worker 启动握手响应无效')
    logger.info('ED2K Worker 启动完成')
    return worker
  }
  catch (cause) {
    worker.terminate()
    if (signal?.aborted)
      throw cause
    logger.warn('ED2K Worker 不可用，回退页面分块计算', cause)
    return null
  }
}

/**
 * ============================================================================
 * 步骤1：校验 ED2K 计算输入
 * ============================================================================
 * 目标：在发起下载前拒绝不完整或超出 JavaScript 安全整数的元数据。
 * 数据源：115 文件列表和下载接口。
 * 操作：
 * 1) 校验名称、大小和 URL
 * 2) 响应上层取消信号
 */
function assertSource(source: Ed2kSource, signal?: AbortSignal) {
  logger.info('开始校验 ED2K 文件输入', source.name, source.size)

  // 1.1 校验参与链接生成和 Range 计算的字段
  if (!source.name)
    throw new Error('文件名不能为空')
  if (!Number.isSafeInteger(source.size) || source.size < 0)
    throw new Error('文件大小无效')
  if (!source.resolve && !URL.canParse(source.url ?? ''))
    throw new Error('115 下载地址无效')

  // 1.2 已取消的任务不创建 Worker 或网络请求
  signal?.throwIfAborted()
  logger.info('ED2K 文件输入校验完成', source.name, source.size)
}

function assertEndpoint(endpoint: Ed2kEndpoint) {
  if (!URL.canParse(endpoint.url))
    throw new Error('115 下载地址无效')
}

function abortError(signal: AbortSignal) {
  return signal.reason ?? new DOMException('请求已取消', 'AbortError')
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal))
    if (signal.aborted) {
      abort()
      return
    }

    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

function waitForRetry(attempt: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(done, RETRY_DELAY * 2 ** (attempt - 1))

    function cleanup() {
      globalThis.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }

    function done() {
      cleanup()
      resolve()
    }

    function abort() {
      cleanup()
      reject(abortError(signal))
    }

    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function resolveEndpoint(source: Ed2kSource, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!source.resolve) {
    const endpoint = { cookie: source.cookie, url: source.url! }
    assertEndpoint(endpoint)
    return endpoint
  }

  try {
    const endpoint = await abortable(source.resolve(signal), signal)
    signal.throwIfAborted()
    assertEndpoint(endpoint)
    return endpoint
  }
  catch (cause) {
    if (signal.aborted)
      throw abortError(signal)
    throw new EndpointResolveError(cause)
  }
}

/**
 * ============================================================================
 * 步骤2：分批读取并计算 ED2K
 * ============================================================================
 * 目标：每次 Range 读取四个协议块，再在 Worker 中分别计算标准摘要。
 * 数据源：115 原文件临时下载地址。
 * 操作：
 * 1) 用两条下载通道分别读取四块批次并严格校验 206 响应
 * 2) 失败批次最多重试三次，每次刷新临时下载地址
 * 3) 保留已完成摘要并按协议块序号汇总生成链接
 */
async function calculate(
  source: Ed2kSource,
  options: Ed2kOptions,
  concurrency: number,
  state: Ed2kState,
) {
  logger.info('开始分段计算 ED2K', source.name, source.size)
  assertSource(source, options.signal)

  const count = Math.ceil(source.size / ED2K_PART_SIZE)
  const batchCount = Math.ceil(source.size / ED2K_BATCH_SIZE)
  if (state.parts.length === 0 && count > 0)
    state.parts.push(...Array.from({ length: count }, () => ''))
  const complete = (index: number) => {
    const start = index * ED2K_BATCH_PARTS
    const length = Math.min(ED2K_BATCH_PARTS, count - start)
    return state.parts.slice(start, start + length).every(Boolean)
  }
  const size = (index: number) => Math.min(
    ED2K_BATCH_SIZE,
    source.size - index * ED2K_BATCH_SIZE,
  )
  const progress = Array.from(
    { length: batchCount },
    (_, index) => complete(index) ? size(index) : 0,
  )
  const batches = Array.from(
    { length: batchCount },
    (_, index) => index,
  ).filter(index => !complete(index))
  const controller = new AbortController()
  let loaded = progress.reduce((total, value) => total + value, 0)
  let next = 0
  let reported = 0

  const report = (
    stage: Ed2kProgress['stage'],
    current = loaded,
    force = stage !== 'download',
  ) => {
    const now = performance.now()
    if (!force && now - reported < PROGRESS_INTERVAL)
      return
    reported = now
    options.onProgress?.({
      loaded: current,
      parts: count,
      speed: current / Math.max((now - state.started) / 1000, 0.001),
      stage,
      total: source.size,
    })
  }

  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted)
    abort()

  const update = (index: number, value: number, force = false) => {
    const current = Math.max(progress[index]!, Math.min(value, size(index)))
    loaded += current - progress[index]!
    progress[index] = current
    report('download', loaded, force)
  }

  const reset = (index: number) => {
    loaded -= progress[index]!
    progress[index] = 0
    report('download', loaded, true)
  }

  const download = async (index: number, endpoint: Ed2kEndpoint) => {
    const start = index * ED2K_BATCH_SIZE
    const end = Math.min(start + ED2K_BATCH_SIZE, source.size) - 1
    const size = end - start + 1
    const started = performance.now()
    logger.info('开始读取 ED2K 网络批次', index + 1, batchCount, start, end)

    /** 2.1 每条通道上报当前批次进度，重试时只重置失败批次。 */
    let response: Response
    try {
      response = await options.request.get(endpoint.url, {
        cache: 'no-cache',
        cookie: endpoint.cookie,
        headers: {
          'Range': `bytes=${start}-${end}`,
          'User-Agent': navigator.userAgent,
        },
        maxResponseBytes: size,
        onProgress: value => update(index, value.loaded),
        redirect: 'follow',
        responseType: 'arraybuffer',
        signal: controller.signal,
        timeout: 180_000,
        validateResponse: ({ status }) => {
          if (status !== 206)
            throw new RangeResponseError(status)
        },
      })
    }
    catch (cause) {
      if (
        controller.signal.aborted
        || cause instanceof RangeResponseError
        || (cause instanceof InfraError && !cause.retryable)
      ) {
        throw cause
      }
      throw new RangeDownloadError(cause)
    }
    assertRange(response, start, end, source.size)

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength !== size)
      throw new RangeIntegrityError('服务器返回的批次字节数与请求不一致')
    update(index, size, true)
    logger.info('ED2K 网络批次读取完成', index + 1, batchCount)
    return {
      buffer,
      downloadMs: performance.now() - started,
    }
  }

  const hash = async (
    index: number,
    buffer: ArrayBuffer,
    worker: Worker | null,
  ) => {
    /** 2.2 网络批次按 9,728,000 字节切片，协议摘要边界保持不变。 */
    const start = index * ED2K_BATCH_PARTS
    const length = Math.min(ED2K_BATCH_PARTS, count - start)
    let hashes: string[]
    if (worker) {
      const result = await send(worker, { type: 'batch', buffer }, {
        signal: controller.signal,
        timeout: WORKER_TASK_TIMEOUT,
        transfer: [buffer],
      })
      if (result.type !== 'batch' || result.hashes.length !== length)
        throw new Error('ED2K Worker 返回了错误的批次响应')
      hashes = result.hashes
    }
    else {
      const data = new Uint8Array(buffer)
      hashes = await Promise.all(Array.from({ length }, (_, offset) => (
        hashEd2kPart(data.subarray(
          offset * ED2K_PART_SIZE,
          Math.min((offset + 1) * ED2K_PART_SIZE, data.byteLength),
        ))
      )))
    }

    hashes.forEach((value, offset) => {
      state.parts[start + offset] = value
    })
    logger.info('ED2K 网络批次摘要完成', index + 1, batchCount, hashes.length)
  }

  interface LaneState {
    endpoint?: Ed2kEndpoint
  }

  const retry = async (index: number, lane: LaneState): Promise<DownloadedBatch> => {
    let last: unknown
    for (let attempt = 0; attempt <= ED2K_NETWORK_RETRIES; attempt += 1) {
      try {
        controller.signal.throwIfAborted()
        if (attempt > 0) {
          await waitForRetry(attempt, controller.signal)
          lane.endpoint = undefined
        }
        if (!lane.endpoint) {
          lane.endpoint = await resolveEndpoint(source, controller.signal)
          state.addresses += 1
        }
        const batch = await download(index, lane.endpoint)
        return {
          attempts: attempt + 1,
          ...batch,
        }
      }
      catch (cause) {
        reset(index)
        if (controller.signal.aborted)
          throw abortError(controller.signal)
        if (
          !(cause instanceof EndpointResolveError)
          && !(cause instanceof RangeDownloadError)
        ) {
          throw cause
        }

        last = cause
        lane.endpoint = undefined
        if (attempt >= ED2K_NETWORK_RETRIES)
          throw cause
        logger.warn(
          'ED2K 网络批次读取失败，准备刷新临时地址重试',
          index + 1,
          batchCount,
          attempt + 1,
          ED2K_NETWORK_RETRIES,
          cause,
        )
      }
    }
    throw last
  }

  const lane = async () => {
    const workerPromise = startWorker(controller.signal)
    let worker: Worker | null = null
    try {
      worker = await workerPromise
      report('download', loaded, true)
      const lane: LaneState = {}
      const queue = () => {
        controller.signal.throwIfAborted()
        const index = batches[next]
        if (index === undefined)
          return
        next += 1
        const pending = retry(index, lane).then(batch => ({ ...batch, index }))
        void pending.catch(() => undefined)
        return pending
      }

      let pending = queue()
      while (pending) {
        const batch = await pending

        // 2.3 当前响应已释放连接，下一批下载与当前 Worker 哈希重叠
        pending = queue()
        const started = performance.now()
        await hash(batch.index, batch.buffer, worker)
        const metric: Ed2kBatchMetric = {
          addresses: state.addresses,
          attempts: batch.attempts,
          batch: batch.index + 1,
          batches: batchCount,
          bytes: size(batch.index),
          downloadMs: batch.downloadMs,
          hashMs: performance.now() - started,
          worker: worker ? 'worker' : 'main',
        }
        options.onBatch?.(metric)
        logger.info('ED2K 网络批次诊断完成', metric)
      }
    }
    catch (cause) {
      controller.abort(cause)
      throw cause
    }
    finally {
      worker ??= await workerPromise.catch(() => null)
      worker?.terminate()
    }
  }

  try {
    report(source.resolve ? 'link' : 'download', loaded, true)
    const lanes = Array.from(
      { length: Math.min(concurrency, batchCount) },
      () => lane(),
    )
    try {
      await Promise.all(lanes)
    }
    catch (cause) {
      controller.abort(cause)
      await Promise.allSettled(lanes)
      throw cause
    }

    // 2.4 原始批次已释放，只在主线程汇总有序的 16 字节摘要
    report('finish')
    const hash = await finishEd2kHash(state.parts, source.size)
    const link = buildEd2kLink(source.name, source.size, hash)
    logger.info('ED2K 分段计算完成', source.name, source.size)
    return link
  }
  finally {
    options.signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}

/**
 * ============================================================================
 * 步骤3：稳定生成 ED2K
 * ============================================================================
 * 目标：用双通道批次流水线利用 115 CDN 突发带宽，并兼容临时非 206 响应。
 * 数据源：批次 Range 响应状态和用户取消信号。
 * 操作：
 * 1) 两条通道独立取临时地址，下载下一批时由 Worker 计算当前批
 * 2) 非 206 时刷新地址，保留已完成摘要后补算
 */
export async function calculateEd2k(source: Ed2kSource, options: Ed2kOptions) {
  logger.info('开始稳定生成 ED2K', source.name, source.size)
  const state: Ed2kState = {
    addresses: 0,
    parts: [],
    started: performance.now(),
  }

  try {
    const link = await calculate(source, options, RANGE_CONCURRENCY, state)
    logger.info('稳定生成 ED2K 完成，双通道流水线', source.name)
    return link
  }
  catch (cause) {
    const count = Math.ceil(source.size / ED2K_BATCH_SIZE)
    if (
      !(cause instanceof RangeResponseError)
      || count <= 1
      || options.signal?.aborted
    ) {
      throw cause
    }

    // 3.1 当前请求已取消并释放，新地址只读取尚未完成的网络批次
    logger.warn('115 CDN 返回非 206，刷新地址并保留已完成摘要', cause.message)
    const link = await calculate(source, options, 1, state)
    logger.info('稳定生成 ED2K 完成，刷新地址模式', source.name)
    return link
  }
}
