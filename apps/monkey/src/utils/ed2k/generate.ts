/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { Ed2kOptions } from './calculate'
import { drive115 } from '@/utils/drive115Instance'
import { appLogger } from '@/utils/logger'
import { GMRequest } from '@/utils/request/gmRequest'
import { calculateEd2k } from './calculate'

const logger = appLogger.sub('ED2KGenerate')

export interface Ed2kFile {
  name: string
  pickCode: string
  size: number
}

export type GenerateEd2kOptions = Omit<Ed2kOptions, 'request'>

/**
 * ============================================================================
 * 步骤1：生成 115 文件 ED2K 链
 * ============================================================================
 * 目标：让独立 Fusion 页和官方页复用同一条下载与计算链。
 * 数据源：文件名、pick code、文件大小和 115 临时下载地址。
 * 操作：
 * 1) 获取原文件临时地址
 * 2) 合并认证 Cookie
 * 3) 分块读取并计算 ED2K
 */
export async function generateEd2k(file: Ed2kFile, options: GenerateEd2kOptions = {}) {
  logger.info('开始生成 115 文件 ED2K 链', file.pickCode, file.name)

  options.onProgress?.({
    loaded: 0,
    parts: 0,
    speed: 0,
    stage: 'link',
    total: file.size,
  })

  // 1.1 获取 115 临时原文件地址
  const download = await drive115.video.getFileDownloadUrl(file.pickCode)
  const auth = download.url.auth_cookie

  // 1.2 认证信息只交给当前 Range 请求，不写持久化存储
  const link = await calculateEd2k({
    cookie: auth ? `${auth.name}=${auth.value}` : undefined,
    name: file.name,
    size: file.size,
    url: download.url.url,
  }, {
    ...options,
    request: new GMRequest(),
  })
  logger.info('115 文件 ED2K 链生成完成', file.pickCode, file.name)
  return link
}
