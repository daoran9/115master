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
  size: number
  url: string
}

export interface Ed2kOptions {
  onProgress?: (progress: Ed2kProgress) => void
  request: IRequest
  signal?: AbortSignal
}

const logger = new Logger('ED2KCalculate')
const WORKER_START_TIMEOUT = 1_500
const WORKER_TASK_TIMEOUT = 30_000

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
    throw new Error('服务器不支持 Range 206，已停止读取以避免整文件一次性载入内存')

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
  if (!URL.canParse(source.url))
    throw new Error('115 下载地址无效')

  // 1.2 已取消的任务不创建 Worker 或网络请求
  signal?.throwIfAborted()
  logger.info('ED2K 文件输入校验完成', source.name, source.size)
}

/**
 * ============================================================================
 * 步骤2：分段读取并计算 ED2K
 * ============================================================================
 * 目标：以 9,728,000 字节 Range 分块读取原文件，在 Worker 中计算摘要。
 * 数据源：115 原文件临时下载地址。
 * 操作：
 * 1) 逐块请求并严格校验 206 响应
 * 2) 转移 ArrayBuffer 到 Worker
 * 3) 汇总摘要并生成链接
 */
export async function calculateEd2k(source: Ed2kSource, options: Ed2kOptions) {
  logger.info('开始分段计算 ED2K', source.name, source.size)
  assertSource(source, options.signal)

  const started = performance.now()
  const parts: string[] = []
  let worker: Worker | null = null
  let loaded = 0

  const report = (stage: Ed2kProgress['stage'], current = loaded) => {
    options.onProgress?.({
      loaded: current,
      parts: Math.ceil(source.size / ED2K_PART_SIZE),
      speed: current / Math.max((performance.now() - started) / 1000, 0.001),
      stage,
      total: source.size,
    })
  }

  try {
    report('download')
    worker = await startWorker(options.signal)

    // 2.1 每次只读取一个 ED2K 标准分块；第一块同时验证 Range 支持
    while (loaded < source.size) {
      options.signal?.throwIfAborted()
      const end = Math.min(loaded + ED2K_PART_SIZE, source.size) - 1
      const size = end - loaded + 1
      report('download')
      const response = await options.request.get(source.url, {
        cache: 'no-cache',
        cookie: source.cookie,
        headers: {
          'Range': `bytes=${loaded}-${end}`,
          'User-Agent': navigator.userAgent,
        },
        maxResponseBytes: size,
        onProgress: progress => report(
          'download',
          loaded + Math.min(progress.loaded, size),
        ),
        redirect: 'follow',
        responseType: 'arraybuffer',
        signal: options.signal,
        timeout: 180_000,
        validateResponse: ({ status }) => {
          if (status !== 206)
            throw new Error('服务器不支持 Range 206，已停止读取以避免整文件一次性载入内存')
        },
      })
      assertRange(response, loaded, end, source.size)

      const buffer = await response.arrayBuffer()
      if (buffer.byteLength !== size)
        throw new Error('服务器返回的分块字节数与请求不一致')

      // 2.2 ArrayBuffer 转移后主线程不再持有视频分块
      report('hash', end + 1)
      if (worker) {
        const result = await send(worker, { type: 'part', buffer }, {
          signal: options.signal,
          timeout: WORKER_TASK_TIMEOUT,
          transfer: [buffer],
        })
        if (result.type !== 'part')
          throw new Error('ED2K Worker 返回了错误的分块响应')
      }
      else {
        parts.push(await hashEd2kPart(new Uint8Array(buffer)))
      }

      loaded = end + 1
      report('download')
    }

    // 2.3 Worker 汇总摘要，主线程只组合最终链接
    report('finish')
    const hash = worker
      ? await send(worker, { type: 'finish', size: source.size }, {
          signal: options.signal,
          timeout: WORKER_TASK_TIMEOUT,
        }).then((result) => {
          if (result.type !== 'result')
            throw new Error('ED2K Worker 未返回文件摘要')
          return result.hash
        })
      : await finishEd2kHash(parts, source.size)

    const link = buildEd2kLink(source.name, source.size, hash)
    logger.info('ED2K 分段计算完成', source.name, source.size)
    return link
  }
  finally {
    worker?.terminate()
  }
}
