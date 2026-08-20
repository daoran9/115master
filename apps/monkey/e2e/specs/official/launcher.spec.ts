import { expect, test } from '@playwright/test'
import { MASTER_URL, OFFICIAL_URL, setupHarness, watch } from '../../support'

test.describe('新版官方页面兼容入口', () => {
  test('未知 DOM 页面显示隔离入口并可打开 MASTER 文件页', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page)
    await page.goto(OFFICIAL_URL)

    /**
     * ================================================================================
     * 步骤1：验证兼容入口
     * ================================================================================
     * 目标：确认脚本不依赖新版官方 DOM 也能显示入口。
     * 操作：
     * 1) 定位 Shadow DOM 内启动按钮
     * 2) 校验按钮地址和唯一性
     */
    const launcher = page.getByRole('link', { name: '打开 115Master Fusion' })
    const controls = page.locator('[data-115master-controls]')
    await expect(launcher).toHaveCount(1)
    await expect(launcher).toHaveAttribute('href', `${MASTER_URL}#/drive`)
    await expect(launcher.locator('svg')).toBeVisible()
    await expect(controls).toHaveAttribute('data-placement', 'floating')
    await expect(controls).toHaveAttribute('data-115master-version', '2.0.0-beta.85')
    await expect(page.getByRole('button', { name: /视频预览/ })).toHaveCount(0)

    /**
     * ================================================================================
     * 步骤2：验证入口自恢复
     * ================================================================================
     * 目标：模拟新版单页应用重绘 body，确认启动入口不会永久丢失。
     * 操作：
     * 1) 删除入口宿主节点
     * 2) 等待 MutationObserver 重新挂载唯一入口
     */
    await page.locator('[data-115master-launcher]').evaluate(node => node.remove())
    await expect(launcher).toHaveCount(1)

    /**
     * ================================================================================
     * 步骤3：验证独立文件页跳转
     * ================================================================================
     * 目标：确认入口能进入不依赖官方 DOM 的 MASTER SPA。
     * 操作：
     * 1) 点击启动按钮
     * 2) 等待 SPA 根节点挂载
     */
    await launcher.click()
    await expect(page).toHaveURL(`${MASTER_URL}#/drive`)
    await expect(page.locator('#my-app')).toBeAttached()
    expect(errors).toEqual([])
  })
})
