/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { IRequest } from '@115master/shared'
import type { Ed2kWorkerRequest, Ed2kWorkerResponse } from './protocol'
import { Logger } from '@115master/shared'
import Ed2kWorker from './ed2k.worker?worker&inline'
import { buildEd2kLink, ED2K_PART_SIZE } from './hash'

export interface Ed2kProgress {
  loaded: number
  parts: number
  speed: number
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

function send(worker: Worker, request: Ed2kWorkerRequest, transfer: Transferable[] = []) {
  return new Promise<Ed2kWorkerResponse>((resolve, reject) => {
    const listeners = {
      message: (event: MessageEvent<Ed2kWorkerResponse>) => {
        worker.removeEventListener('message', listeners.message)
        worker.removeEventListener('error', listeners.error)
        if (event.data.type === 'error') {
          reject(new Error(event.data.message))
          return
        }
        resolve(event.data)
      },
      error: (event: ErrorEvent) => {
        worker.removeEventListener('message', listeners.message)
        worker.removeEventListener('error', listeners.error)
        reject(event.error ?? new Error(event.message))
      },
    }

    worker.addEventListener('message', listeners.message)
    worker.addEventListener('error', listeners.error)
    worker.postMessage(request, transfer)
  })
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

  const worker = new Ed2kWorker()
  const started = performance.now()
  let loaded = 0

  try {
    // 2.1 每次只读取一个 ED2K 标准分块；第一块同时验证 Range 支持
    while (loaded < source.size) {
      options.signal?.throwIfAborted()
      const end = Math.min(loaded + ED2K_PART_SIZE, source.size) - 1
      const response = await options.request.get(source.url, {
        cache: 'no-cache',
        cookie: source.cookie,
        headers: { Range: `bytes=${loaded}-${end}` },
        redirect: 'follow',
        responseType: 'arraybuffer',
        signal: options.signal,
        timeout: 180_000,
      })
      assertRange(response, loaded, end, source.size)

      const buffer = await response.arrayBuffer()
      if (buffer.byteLength !== end - loaded + 1)
        throw new Error('服务器返回的分块字节数与请求不一致')

      // 2.2 ArrayBuffer 转移后主线程不再持有视频分块
      const result = await send(worker, { type: 'part', buffer }, [buffer])
      if (result.type !== 'part')
        throw new Error('ED2K Worker 返回了错误的分块响应')

      loaded = end + 1
      options.onProgress?.({
        loaded,
        parts: Math.ceil(source.size / ED2K_PART_SIZE),
        speed: loaded / Math.max((performance.now() - started) / 1000, 0.001),
        total: source.size,
      })
    }

    // 2.3 Worker 汇总摘要，主线程只组合最终链接
    const result = await send(worker, { type: 'finish', size: source.size })
    if (result.type !== 'result')
      throw new Error('ED2K Worker 未返回文件摘要')

    const link = buildEd2kLink(source.name, source.size, result.hash)
    logger.info('ED2K 分段计算完成', source.name, source.size)
    return link
  }
  finally {
    worker.terminate()
  }
}
