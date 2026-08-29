import { expect, test } from '@playwright/test'
import { EPISODES, JAV_EPISODE, setupVideo, showControls, videoUrl, watch } from './support'

/** 字幕：搜索结果入菜单、选择后轨道加载、关闭字幕 */
test.describe('字幕', () => {
  test('字幕菜单列出搜索结果，选择后展示字幕文本', async ({ page }) => {
    const errors = watch(page)
    await setupVideo(page, { download: true, subtitles: true })
    await page.goto(videoUrl(EPISODES[0].pc))
    await showControls(page)

    /** thunder 返回两条结果 → 字幕按钮可用（subtitlecat 无番号、115 内嵌为空） */
    const button = page.locator('button[title^="字幕"]')
    await expect(button).toBeEnabled()
    await expect(page.getByText('第一行字幕')).toBeVisible()
    await button.click()

    /** 菜单：关闭字幕 + 两条搜索结果（label 为去扩展名标题） */
    const menu = page.locator('.x-popup').filter({ has: page.getByText('关闭字幕') })
    await expect(menu.getByText('关闭字幕')).toBeVisible()
    await expect(menu.locator('.ui-scrollbar.ui-scrollbar-md.overflow-y-auto')).toHaveCount(1)
    await expect(menu.locator('a[title="剧集 第01集.chs"]')).toBeVisible()
    await expect(menu.locator('a[title="剧集 第01集.eng"]')).toBeVisible()
    await expect(menu.getByRole('button', { name: '查看 剧集 第01集.chs' })).toBeVisible()
    await expect(menu.getByRole('button', { name: '下载 剧集 第01集.chs' })).toBeVisible()

    // 选择中文字幕：菜单关闭，字幕容器与首条 cue 文本展示（当前时间 0s 命中 0-4s cue）
    await menu.locator('a[title="剧集 第01集.chs"]').click({ position: { x: 20, y: 10 } })
    await expect(menu).toBeHidden()
    await expect(page.getByText('第一行字幕')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('选择「关闭字幕」后字幕隐藏', async ({ page }) => {
    const errors = watch(page)
    await setupVideo(page, { download: true, subtitles: true })
    await page.goto(videoUrl(EPISODES[0].pc))
    await showControls(page)

    const button = page.locator('button[title^="字幕"]')
    await expect(button).toBeEnabled()
    await button.click()
    const menu = page.locator('.x-popup').filter({ has: page.getByText('关闭字幕') })
    await menu.locator('a[title="剧集 第01集.eng"]').click({ position: { x: 20, y: 10 } })
    await expect(page.getByText('第一行字幕')).toBeVisible()

    // 控制栏可能已自动隐藏，重新悬停后再打开菜单选择关闭
    await showControls(page)
    await button.click()
    await menu.getByText('关闭字幕').click()
    await expect(page.getByText('第一行字幕')).toBeHidden()
    expect(errors).toEqual([])
  })

  test('JAV 视频融合全部字幕来源并过滤相似番号', async ({ page }) => {
    const errors = watch(page)
    await setupVideo(page, {
      download: true,
      episode: JAV_EPISODE,
      javSubtitles: true,
    })
    await page.goto(videoUrl(JAV_EPISODE.pc))
    await showControls(page)

    /*
     * ================================================================================
     * 步骤1：核对字幕来源和番号
     * ================================================================================
     * 目标：五个来源都进入菜单，JAC-0890 不得混入 JAC-089。
     * 数据源：播放器字幕菜单。
     * 操作：
     * 1) 检查来源标签
     * 2) 检查冲突番号已过滤
     */
    console.info('[e2e] 开始核对 JAV 字幕来源')

    const button = page.locator('button[title^="字幕"]')
    await expect(button).toBeEnabled()
    await button.click()
    const menu = page.locator('.x-popup').filter({ has: page.getByText('关闭字幕') })
    for (const source of ['Thunder', 'Subtitle Cat', 'AVSubtitles', '爱译网', 'Built-in'])
      await expect(menu.getByText(source, { exact: true })).toBeVisible()
    await expect(menu.getByText(/JAC-0890/)).toHaveCount(0)

    console.info('[e2e] JAV 字幕来源核对完成')

    /*
     * ================================================================================
     * 步骤2：切换并渲染各来源字幕
     * ================================================================================
     * 目标：证明菜单中的每个来源都携带可解析字幕，而非只有来源标签。
     * 数据源：五个来源各自不同的首条 cue。
     * 操作：
     * 1) 逐一选择来源
     * 2) 检查播放器显示对应文本
     */
    console.info('[e2e] 开始切换 JAV 字幕来源')

    const expected = new Map([
      ['Thunder', 'Thunder JAC-089'],
      ['Subtitle Cat', 'SubtitleCat JAC-089'],
      ['AVSubtitles', 'AVSubtitles JAC-089'],
      ['爱译网', '爱译网 JAC-089'],
      ['Built-in', '115内置 JAC-089'],
    ])
    for (const [source, text] of expected) {
      const item = menu.locator('a').filter({ hasText: source })
      await expect(item).toHaveCount(1)
      await item.dispatchEvent('click')
      await expect(page.getByText(text, { exact: true })).toBeVisible()
    }

    console.info('[e2e] JAV 字幕来源切换完成')
    expect(errors).toEqual([])
  })
})
