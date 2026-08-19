/// <reference lib="webworker" />

/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { Ed2kWorkerRequest, Ed2kWorkerResponse } from './protocol'
import { Logger } from '@115master/shared'
import { hashEd2kPart } from './hash'

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
 * 数据源：主线程逐块转移的 ArrayBuffer。
 * 操作：
 * 1) 响应启动握手
 * 2) 计算独立分块摘要
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

    // 1.2 Worker 只返回当前摘要，主线程按 Range 序号保存结果
    const hash = await hashEd2kPart(new Uint8Array(event.data.buffer))
    publish({ type: 'part', hash })
    logger.info('ED2K Worker 分块处理完成', event.data.buffer.byteLength)
  }
  catch (cause) {
    // 1.3 Worker 内异常转换为可序列化消息
    const message = cause instanceof Error ? cause.message : String(cause)
    publish({ type: 'error', message })
    logger.info('ED2K Worker 消息处理结束，发生错误', message)
  }
}
