// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import SubtitleDisplay from '../SubtitleDisplay.vue'

const apps: ReturnType<typeof createApp>[] = []

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount())
})

describe('subtitleDisplay', () => {
  it('显示紧凑图标按钮且点击时不触发字幕条目', () => {
    /**
     * ============================================================================
     * 步骤1：验证字幕操作按钮
     * ============================================================================
     * 目标：查看和下载使用紧凑图标按钮，点击操作不会冒泡到字幕条目。
     * 数据源：带操作按钮的 SubtitleDisplay fixture。
     * 操作：
     * 1) 挂载字幕条目并监听外层点击。
     * 2) 点击两个操作按钮并核对事件边界。
     */
    const logger = { info: vi.fn() }
    const onItemClick = vi.fn()
    const onView = vi.fn()
    const onDownload = vi.fn()
    const host = document.createElement('div')
    const app = createApp({
      setup: () => () => h('a', { onClick: onItemClick }, [
        h(SubtitleDisplay, {
          label: 'NPJS-268 中文字幕',
          format: 'srt',
          source: 'Thunder',
          subtitleIndex: 1,
          total: 1,
          showActions: true,
          onView,
          onDownload,
        }),
      ]),
    })
    logger.info('开始验证字幕操作按钮')
    app.mount(host)
    apps.push(app)

    /** 1.1 核对图标按钮尺寸和无障碍名称 */
    const view = host.querySelector<HTMLButtonElement>('button[aria-label="查看 NPJS-268 中文字幕"]')
    const download = host.querySelector<HTMLButtonElement>('button[aria-label="下载 NPJS-268 中文字幕"]')
    expect(view?.textContent?.trim()).toBe('')
    expect(download?.textContent?.trim()).toBe('')
    expect(view?.classList).toContain('btn-circle')
    expect(download?.classList).toContain('btn-circle')

    /** 1.2 点击操作按钮，不触发外层字幕选择 */
    view?.click()
    download?.click()
    expect(onView).toHaveBeenCalledOnce()
    expect(onDownload).toHaveBeenCalledOnce()
    expect(onItemClick).not.toHaveBeenCalled()
    logger.info('字幕操作按钮验证完成')
  })
})
