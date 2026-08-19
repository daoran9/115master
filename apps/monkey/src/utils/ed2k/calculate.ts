import type { IRequest } from '@115master/shared'
import type { Ed2kWorkerRequest, Ed2kWorkerResponse } from './protocol'
import { Logger } from '@115master/shared'
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

export interface Ed2kSource {
  cookie?: string
  name: string
  resolve?: () => Promise<Ed2kEndpoint>
  size: number
  url?: string
}

export interface Ed2kEndpoint {
  cookie?: string
  url: string
}

export interface Ed2kOptions {
  onProgress?: (progress: Ed2kProgress) => void
  request: IRequest
  signal?: AbortSignal
}

const logger = new Logger('ED2KCalculate')
const RANGE_CONCURRENCY = 3
const WORKER_START_TIMEOUT = 1_500
const WORKER_TASK_TIMEOUT = 30_000

class RangeResponseError extends Error {
  constructor(status: number) {
    super(`服务器不支持 Range 206（HTTP ${status}），已停止读取以避免整文件一次性载入内存`)
    this.name = 'RangeResponseError'
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
    throw new Error('服务器返回的 Content-Range 与请求不一致')
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

/**
 * ============================================================================
 * 步骤2：分段读取并计算 ED2K
 * ============================================================================
 * 目标：以 9,728,000 字节 Range 分块读取原文件，在 Worker 中计算摘要。
 * 数据源：115 原文件临时下载地址。
 * 操作：
 * 1) 用三个下载槽并发请求并严格校验 206 响应
 * 2) 按 Range 序号保存 Worker 摘要
 * 3) 汇总摘要并生成链接
 */
async function calculate(
  source: Ed2kSource,
  options: Ed2kOptions,
  concurrency: number,
) {
  logger.info('开始分段计算 ED2K', source.name, source.size)
  assertSource(source, options.signal)

  const started = performance.now()
  const count = Math.ceil(source.size / ED2K_PART_SIZE)
  const parts = Array.from({ length: count }, () => '')
  const progress = Array.from({ length: count }, () => 0)
  const controller = new AbortController()
  let loaded = 0
  let next = 0

  const report = (stage: Ed2kProgress['stage'], current = loaded) => {
    options.onProgress?.({
      loaded: current,
      parts: count,
      speed: current / Math.max((performance.now() - started) / 1000, 0.001),
      stage,
      total: source.size,
    })
  }

  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted)
    abort()

  const update = (index: number, value: number) => {
    const start = index * ED2K_PART_SIZE
    const size = Math.min(ED2K_PART_SIZE, source.size - start)
    const current = Math.max(progress[index]!, Math.min(value, size))
    loaded += current - progress[index]!
    progress[index] = current
    report('download')
  }

  const download = async (index: number, endpoint: Ed2kEndpoint) => {
    const start = index * ED2K_PART_SIZE
    const end = Math.min(start + ED2K_PART_SIZE, source.size) - 1
    const size = end - start + 1
    logger.info('开始读取 ED2K 分块', index + 1, count, start, end)

    /** 2.1 每个下载槽独立上报进度，汇总时去除重复事件字节。 */
    const response = await options.request.get(endpoint.url, {
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
    assertRange(response, start, end, source.size)

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength !== size)
      throw new Error('服务器返回的分块字节数与请求不一致')
    update(index, size)
    logger.info('ED2K 分块读取完成', index + 1, count)
    return buffer
  }

  const hash = async (
    index: number,
    buffer: ArrayBuffer,
    worker: Worker | null,
  ) => {
    // 2.2 下载槽已开始读取下一块，再计算当前块以隐藏 MD4 耗时
    report('hash')
    if (worker) {
      const result = await send(worker, { type: 'part', buffer }, {
        signal: controller.signal,
        timeout: WORKER_TASK_TIMEOUT,
        transfer: [buffer],
      })
      if (result.type !== 'part')
        throw new Error('ED2K Worker 返回了错误的分块响应')
      parts[index] = result.hash
    }
    else {
      parts[index] = await hashEd2kPart(new Uint8Array(buffer))
    }

    logger.info('ED2K 分块摘要完成', index + 1, count)
  }

  const lane = async () => {
    const workerPromise = startWorker(controller.signal)
    let worker: Worker | null = null
    try {
      const resolved = await Promise.all([
        workerPromise,
        source.resolve
          ? source.resolve()
          : Promise.resolve({ cookie: source.cookie, url: source.url! }),
      ])
      worker = resolved[0]
      const endpoint = resolved[1]
      assertEndpoint(endpoint)
      report('download')

      const queue = () => {
        controller.signal.throwIfAborted()
        const index = next
        if (index >= count)
          return
        next += 1
        const pending = download(index, endpoint).then(buffer => ({
          buffer,
          index,
        }))
        void pending.catch(() => undefined)
        return pending
      }

      let pending = queue()
      while (pending) {
        const part = await pending

        // 2.3 当前响应已完整释放连接，下一块下载与当前 Worker 哈希重叠
        pending = queue()
        await hash(part.index, part.buffer, worker)
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
    report(source.resolve ? 'link' : 'download')
    const lanes = Array.from(
      { length: Math.min(concurrency, count) },
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

    // 2.4 原始分块已释放，只在主线程汇总有序的 16 字节摘要
    report('finish')
    const hash = await finishEd2kHash(parts, source.size)
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
 * 步骤3：自适应生成 ED2K
 * ============================================================================
 * 目标：支持多路 Range 的 CDN 使用三路并发，受限节点自动回退单连接。
 * 数据源：并发阶段的 Range 响应状态和用户取消信号。
 * 操作：
 * 1) 优先尝试三个下载槽
 * 2) 非 206 时清理并发任务并从零串行重试
 */
export async function calculateEd2k(source: Ed2kSource, options: Ed2kOptions) {
  logger.info('开始自适应生成 ED2K', source.name, source.size)

  try {
    const link = await calculate(source, options, RANGE_CONCURRENCY)
    logger.info('自适应生成 ED2K 完成，并发模式', source.name)
    return link
  }
  catch (cause) {
    const count = Math.ceil(source.size / ED2K_PART_SIZE)
    if (
      !(cause instanceof RangeResponseError)
      || count <= 1
      || options.signal?.aborted
    ) {
      throw cause
    }

    // 3.1 并发请求已全部取消并释放，再用一个新地址从零串行读取
    logger.warn('115 CDN 拒绝多路 Range，回退单连接', cause.message)
    const link = await calculate(source, options, 1)
    logger.info('自适应生成 ED2K 完成，单连接模式', source.name)
    return link
  }
}
