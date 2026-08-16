import type { IRequest } from '@115master/shared'
import { zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { AvSubtitles } from './avSubtitles.ts'

/* eslint-disable jsdoc/convert-to-jsdoc-comments */

const logger = {
  info: (...args: unknown[]) => console.info('[AVSubtitlesTest]', ...args),
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

describe('subtitleSource.AvSubtitles', () => {
  it('只下载精确番号并从 ZIP 选择对应字幕', async () => {
    /*
     * ================================================================================
     * 步骤1：构造 AVSubtitles 完整下载链路
     * ================================================================================
     * 目标：搜索结果含相似番号时只请求 JAC-089，并从 ZIP 排除 JAC-090。
     * 数据源：搜索页、影片页、字幕详情页、下载页和 ZIP 字节。
     * 操作：
     * 1) 模拟每一跳响应
     * 2) 断言最终播放器字幕内容和番号
     */
    logger.info('开始验证 AVSubtitles 精确番号和 ZIP 选择')

    // 1.1 ZIP 同时放入目标番号和冲突番号字幕。
    const zip = zipSync({
      'JAC-090.zh.srt': new TextEncoder().encode('wrong'),
      'JAC-089.zh.srt': new TextEncoder().encode('correct'),
    })
    const get = vi.fn<IRequest['get']>(async (url) => {
      if (url.includes('search_results.php')) {
        return new Response(`
          <a href="/movie100/jac-089">JAC-089</a>
          <a href="/movie101/jac-0890">JAC-0890</a>
        `)
      }
      if (url.includes('/movie100/'))
        return new Response('<a href="/subtitles/zh/500">Chinese</a>')
      if (url.includes('/subtitles/zh/500')) {
        return new Response(`
          <input name="subid" value="500">
          <input name="revid" value="9">
          <span class="text-mono">JAC-089.zip</span>
        `)
      }
      if (url.includes('/download_page.php'))
        return new Response('<a href="/download_sub.php?subid=500&revid=9">Download</a>')
      if (url.includes('/download_sub.php')) {
        return new Response(zip, {
          headers: {
            'content-disposition': 'attachment; filename="JAC-089.zip"',
            'content-type': 'application/zip',
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const source = new AvSubtitles({ request: request(get), extractAvNumber: extract })

    // 1.2 完整链路只返回目标番号的可播放 SRT。
    const results = await source.fetchSubtitle('JAC-089', 'zh-CN')

    expect(results).toHaveLength(1)
    expect(results[0]?.avNumber).toBe('JAC-089')
    expect(results[0]?.format).toBe('srt')
    expect(await results[0]?.raw.text()).toBe('correct')
    expect(get.mock.calls.some(call => String(call[0]).includes('/movie101/'))).toBe(false)
    logger.info('AVSubtitles 精确番号和 ZIP 选择验证完成')
  })

  it('空番号和不支持语言不发请求', async () => {
    const get = vi.fn<IRequest['get']>()
    const source = new AvSubtitles({ request: request(get), extractAvNumber: extract })

    expect(await source.fetchSubtitle('', 'zh-CN')).toEqual([])
    expect(await source.fetchSubtitle('JAC-089', 'fr')).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })
})
