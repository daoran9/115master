/// <reference lib="webworker" />

/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { Ed2kWorkerRequest, Ed2kWorkerResponse } from './protocol'
import { Logger } from '@115master/shared'
import { finishEd2kHash, hashEd2kPart } from './hash'

const logger = new Logger('ED2KWorker')
const parts: string[] = []
const scope = globalThis as unknown as DedicatedWorkerGlobalScope

function publish(message: Ed2kWorkerResponse) {
  scope.postMessage(message)
}

/**
 * ============================================================================
 * 步骤1：处理 ED2K Worker 消息
 * ============================================================================
 * 目标：把 MD4 计算移出页面主线程，并只保留 16 字节分块摘要。
 * 数据源：主线程逐块转移的 ArrayBuffer 和最终文件大小。
 * 操作：
 * 1) 计算并暂存分块摘要
 * 2) 汇总文件摘要
 * 3) 把错误归一化后返回主线程
 */
scope.onmessage = async (event: MessageEvent<Ed2kWorkerRequest>) => {
  logger.info('开始处理 ED2K Worker 消息', event.data.type)

  try {
    // 1.1 分块数据只在 Worker 内参与计算，完成后释放原始字节
    if (event.data.type === 'part') {
      const hash = await hashEd2kPart(new Uint8Array(event.data.buffer))
      parts.push(hash)
      publish({ type: 'part', hash })
      logger.info('ED2K Worker 分块处理完成', parts.length)
      return
    }

    // 1.2 全部分块完成后生成最终文件摘要
    const hash = await finishEd2kHash(parts, event.data.size)
    publish({ type: 'result', hash })
    logger.info('ED2K Worker 文件处理完成', event.data.size)
  }
  catch (cause) {
    // 1.3 Worker 内异常转换为可序列化消息
    const message = cause instanceof Error ? cause.message : String(cause)
    publish({ type: 'error', message })
    logger.info('ED2K Worker 消息处理结束，发生错误', message)
  }
}
