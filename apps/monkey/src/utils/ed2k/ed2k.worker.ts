/// <reference lib="webworker" />

/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { Ed2kWorkerRequest, Ed2kWorkerResponse } from './protocol'
import { Logger } from '@115master/shared'
import { ED2K_PART_SIZE, hashEd2kPart } from './hash'

const logger = new Logger('ED2KWorker')
const scope = globalThis as unknown as DedicatedWorkerGlobalScope

function publish(message: Ed2kWorkerResponse) {
  scope.postMessage(message)
}

/**
 * ============================================================================
 * 步骤1：处理 ED2K Worker 消息
 * ============================================================================
 * 目标：把 MD4 计算移出页面主线程，并只保留 16 字节分块摘要。
 * 数据源：主线程按四个协议块转移的网络批次 ArrayBuffer。
 * 操作：
 * 1) 响应启动握手
 * 2) 把网络批次切回标准 ED2K 分块并分别计算摘要
 * 3) 把错误归一化后返回主线程
 */
scope.onmessage = async (event: MessageEvent<Ed2kWorkerRequest>) => {
  logger.info('开始处理 ED2K Worker 消息', event.data.type)

  try {
    // 1.1 启动握手用于识别脚本加载失败但未触发 error 的浏览器
    if (event.data.type === 'ping') {
      publish({ type: 'ready' })
      logger.info('ED2K Worker 启动握手完成')
      return
    }

    // 1.2 网络层可合并读取，但每个摘要仍严格覆盖一个标准协议块
    const data = new Uint8Array(event.data.buffer)
    const hashes = await Promise.all(Array.from(
      { length: Math.ceil(data.byteLength / ED2K_PART_SIZE) },
      (_, index) => hashEd2kPart(data.subarray(
        index * ED2K_PART_SIZE,
        Math.min((index + 1) * ED2K_PART_SIZE, data.byteLength),
      )),
    ))
    publish({ type: 'batch', hashes })
    logger.info('ED2K Worker 批次处理完成', hashes.length, data.byteLength)
  }
  catch (cause) {
    // 1.3 Worker 内异常转换为可序列化消息
    const message = cause instanceof Error ? cause.message : String(cause)
    publish({ type: 'error', message })
    logger.info('ED2K Worker 消息处理结束，发生错误', message)
  }
}
