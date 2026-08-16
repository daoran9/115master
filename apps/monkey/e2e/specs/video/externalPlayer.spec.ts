import { expect, test } from '@playwright/test'
import { EPISODES, setupVideo, videoUrl, watch } from './support'

test.describe('Windows 外部播放器', () => {
  test.use({
    userAgent: 'Mozilla/5.0 Windows NT 10.0 Win64 x64 Chrome/130.0',
  })

  test('MPV 按钮生成固定本地协议和鉴权参数', async ({ page }) => {
    const errors = watch(page)
    await page.addInitScript(() => {
      const target = window as unknown as { __openedProtocols: string[] }
      target.__openedProtocols = []
      window.open = (url) => {
        target.__openedProtocols.push(String(url))
        return null
      }
    })
    await setupVideo(page, { download: true })
    await page.goto(videoUrl(EPISODES[0].pc))

    /**
     * ================================================================================
     * 步骤1：验证 Windows MPV 可见入口
     * ================================================================================
     * 目标：Windows 播放页显示 MPV 按钮，并生成本地协议而不是 macOS Shortcuts。
     * 数据源：文件下载 mock 和 window.open 记录。
     * 操作：
     * 1) 点击 MPV 播放按钮
     * 2) 解析协议并核对媒体地址与 User-Agent
     */
    const button = page.locator('button[title^="MPV 播放"]')
    await expect(button).toBeVisible()
    await button.click()
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __openedProtocols: string[] }
    ).__openedProtocols)).toHaveLength(1)

    const opened = await page.evaluate(() => (
      window as unknown as { __openedProtocols: string[] }
    ).__openedProtocols[0])
    const protocol = new URL(opened)
    expect(protocol.protocol).toBe('master115-mpv:')
    expect(protocol.host).toBe('play')
    expect(protocol.searchParams.get('url')).toBe('https://media.e2e.local/video.mp4')
    expect(protocol.searchParams.get('userAgent')).toContain('Windows NT 10.0')
    expect(opened).not.toContain('shortcuts://')
    expect(errors).toEqual([])
  })
})
