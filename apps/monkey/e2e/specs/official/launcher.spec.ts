import { expect, test } from '@playwright/test'
import { CORS, MASTER_URL, OFFICIAL_URL, setupHarness, watch } from '../../support'

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
    await expect(controls).toHaveAttribute('data-115master-version', '2.0.0-beta.101')
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

  test('旧版同源 iframe 保留原版预览入口，不挂载 Fusion 工具组', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/web\/new-drive\//, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: `<!DOCTYPE html>
              <html><body style="margin:0">
                <iframe data-legacy-frame style="width:100%;height:180px;border:0"></iframe>
              </body></html>`,
          })
          return true
        })
      },
    })
    await page.goto(OFFICIAL_URL)
    await page.locator('[data-legacy-frame]').evaluate((frame, source) => {
      ;(frame as HTMLIFrameElement).srcdoc = source
    }, `<!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; }
            [data-legacy-toolbar] { position: relative; display: flex; height: 48px; align-items: center; gap: 8px; padding: 8px; box-sizing: border-box; }
            .button { display: inline-flex; height: 32px; align-items: center; padding: 0 12px; border: 1px solid #d4d9e1; background: #fff; }
            [data-selection-toolbar] { position: absolute; z-index: 2; inset: 0; display: none; align-items: center; background: #fff; color: #1677ff; }
            body.selected [data-selection-toolbar] { display: flex; }
          </style>
        </head>
        <body>
          <div data-legacy-toolbar>
            <a class="button">更多</a>
            <a class="button master-preview-switch-btn">预览</a>
            <div data-selection-toolbar>置顶 下载 移动 标签 重命名 备注 星标 删除 分享 更多 取消</div>
          </div>
        </body>
      </html>`)

    /**
     * ================================================================================
     * 步骤1：验证旧版 iframe 保留原版工具栏
     * ================================================================================
     * 目标：旧版页面保留原版预览按钮，不重复显示 Fusion 启动入口。
     * 数据源：同源 iframe 的预览开关和 Fusion 宿主。
     * 操作：
     * 1) 核对原版预览按钮仍可见
     * 2) 核对 Fusion 宿主已卸载
     */
    console.info('[e2e] 开始核对旧版 iframe 原版工具栏')

    const frame = page.frameLocator('[data-legacy-frame]')
    const controls = frame.locator('[data-115master-controls]')
    await expect(frame.locator('.master-preview-switch-btn')).toBeVisible()
    await expect(controls).toHaveCount(0)

    console.info('[e2e] 旧版 iframe 原版工具栏核对完成')
    expect(errors).toEqual([])
  })

  test('旧版搜索页保留 115Master 入口，不创建 Fusion 启动按钮', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/\?url=/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: `<!DOCTYPE html>
              <html>
                <head>
                  <script>
                    window.Main = { CONFIG: { TopPanelBox: '#js_top_panel_box' } }
                  </script>
                  <style>
                    body { margin: 0; }
                    .main-top { display: flex; height: 60px; align-items: stretch; }
                    .panel-nav { display: flex; height: 60px; align-items: stretch; }
                    .panel-nav a { display: inline-flex; width: 96px; align-items: center; justify-content: center; }
                    .top-side { display: flex; width: 72px; height: 600px; flex-direction: column; }
                    .top-side a { height: 60px; flex: 0 0 60px; }
                    .search-results { margin-left: 72px; padding: 24px; }
                  </style>
                </head>
                <body>
                  <div class="main-top">
                    <div class="panel-nav">
                      <a data-nav="file">网盘</a>
                      <a class="master-drive-link" href="https://115.com/web/lixian/master/#/drive">115Master</a>
                    </div>
                    <div id="js_top_panel_box"></div>
                  </div>
                  <div class="top-side"><a href="javascript:;">新建</a></div>
                  <div class="search-results">搜索：痉挛崩坏</div>
                </body>
              </html>`,
          })
          return true
        })
      },
    })
    await page.goto('https://115.com/?url=%2F%3Fmode%3Dsearch&submode=wangpan&mode=search')

    /**
     * ================================================================================
     * 步骤1：验证旧版搜索态原版入口
     * ================================================================================
     * 目标：搜索态没有预览开关时，保留旧版 115Master，不重复创建 Fusion 入口。
     * 数据源：旧版 .panel-nav、左侧“新建”菜单和 Fusion 宿主。
     * 操作：
     * 1) 核对 115Master 入口可见
     * 2) 核对 Fusion 宿主不存在
     */
    const controls = page.locator('[data-115master-controls]')
    const masterLink = page.locator('.panel-nav a.master-drive-link')
    await expect(masterLink).toBeVisible()
    await expect(controls).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('没有旧版顶栏入口且新建位于纵向导航时使用浮动回退', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/\?vertical=1$/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: `<!DOCTYPE html>
              <html>
                <head>
                  <style>
                    body { margin: 0; }
                    .top-side { display: flex; width: 72px; height: 600px; flex-direction: column; }
                    .top-side a { height: 60px; flex: 0 0 60px; }
                  </style>
                </head>
                <body>
                  <div class="top-side"><a href="javascript:;">新建</a></div>
                  <main>未知页面</main>
                </body>
              </html>`,
          })
          return true
        })
      },
    })
    await page.goto('https://115.com/?vertical=1')

    /** 纵向导航不是安全挂载点，Fusion 应回退到视口浮动层。 */
    const controls = page.locator('[data-115master-controls]')
    await expect(controls).toHaveAttribute('data-placement', 'floating')
    await expect(controls).toHaveCSS('position', 'fixed')
    await expect(controls).toHaveCSS('z-index', '2147483646')
    expect(errors).toEqual([])
  })
})
