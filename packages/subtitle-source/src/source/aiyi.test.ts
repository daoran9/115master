import type { IRequest } from '@115master/shared'
import { describe, expect, it, vi } from 'vitest'
import { Aiyi } from './aiyi.ts'

/* eslint-disable jsdoc/convert-to-jsdoc-comments */

const logger = {
  info: (...args: unknown[]) => console.info('[AiyiTest]', ...args),
}

function extract(value: string): null | string {
  const match = value.match(/(?<![A-Z0-9])([A-Z]{2,8})[-_\s]?(\d{2,6})(?!\d)/i)
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : null
}

function request(get: IRequest['get']): IRequest {
  return {
    get,
    post: vi.fn(),
    request: vi.fn(),
  }
}

describe('subtitleSource.Aiyi', () => {
  it('过滤相似番号并下载精确番号直链字幕', async () => {
    /*
     * ================================================================================
     * 步骤1：验证爱译网精确番号链路
     * ================================================================================
     * 目标：API 同时返回 JAC-089 和 JAC-0890 时只下载目标文章。
     * 数据源：WordPress 搜索响应、文章页和 SRT 直链。
     * 操作：
     * 1) 模拟精确和相似候选
     * 2) 断言只保留目标字幕
     */
    logger.info('开始验证爱译网精确番号链路')

    // 1.1 API 返回一条精确候选和一条相似候选。
    const get = vi.fn<IRequest['get']>(async (url) => {
      if (url.includes('/wp-json/wp/v2/search')) {
        return Response.json([
          { title: 'JAC-089 中文字幕', url: 'https://www.aiyi1.com/100.html' },
          { title: 'JAC-0890 中文字幕', url: 'https://www.aiyi1.com/101.html' },
        ])
      }
      if (url.includes('/100.html'))
        return new Response('<a href="/files/JAC-089.zh-CN.srt">下载字幕</a>')
      if (url.includes('/files/JAC-089.zh-CN.srt')) {
        return new Response('correct subtitle', {
          headers: { 'content-type': 'application/x-subrip' },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const source = new Aiyi({ request: request(get), extractAvNumber: extract })

    // 1.2 结果带来源和标准番号，且没有访问相似番号文章。
    const results = await source.fetchSubtitle('JAC-089', 'zh-CN')

    expect(results).toHaveLength(1)
    expect(results[0]?.source).toBe('爱译网')
    expect(results[0]?.avNumber).toBe('JAC-089')
    expect(await results[0]?.raw.text()).toBe('correct subtitle')
    expect(get.mock.calls.some(call => String(call[0]).includes('/101.html'))).toBe(false)
    logger.info('爱译网精确番号链路验证完成')
  })

  it('非中文模式不发请求', async () => {
    const get = vi.fn<IRequest['get']>()
    const source = new Aiyi({ request: request(get), extractAvNumber: extract })

    expect(await source.fetchSubtitle('JAC-089', 'en')).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })
})
