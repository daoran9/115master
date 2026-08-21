import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { CORS, gmRequests, HOME_URL, json, setupHarness } from '../../support'
import { gmStore, replaceList, watch, watchTabs } from '../../support/homeUtils'
import { html } from '../../support/mockApi'
import { homeHtml } from '../../support/pages/homeHtml'

const logger = console

/**
 * FileListMod：文件列表增强（FileItemMod 插件数组）
 * 融合版按运行时设置加载 videoCover / extInfo / actressInfo 等增强。
 */
test.describe('FileListMod', () => {
  test('初始加载：按项类型注入对应增强', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page)
    await page.goto(HOME_URL)

    // 40 个视频项注入 Master / 官方播放 / ED2K 按钮（FileItemModExtMenu）
    // 注：类名 115-player 以数字开头，须用属性选择器
    await expect(page.locator('a.master-player')).toHaveCount(40)
    await expect(page.locator('a[class="115-player"]')).toHaveCount(40)
    await expect(page.locator('a.ed2k-link')).toHaveCount(40)
    const masterBtn = page.locator('li[iv="1"] a.master-player').first()
    await expect(masterBtn).toHaveAttribute('title', '使用【Master播放器】')
    await expect(masterBtn).toHaveText('▶️ Master 播放')
    const officialBtn = page.locator('li[iv="1"] a[class="115-player"]').first()
    await expect(officialBtn).toHaveAttribute('title', '使用【115官方播放器】')
    await expect(officialBtn).toHaveText('5️⃣ 官方播放')
    const ed2kBtn = page.locator('li[iv="1"] a.ed2k-link').first()
    await expect(ed2kBtn).toHaveAttribute('title', '生成 ED2K 链')
    await expect(ed2kBtn).toHaveText('ED2K')

    /*
     * ================================================================================
     * 步骤1：核对旧版操作入口顺序
     * ================================================================================
     * 目标：新增 ED2K 不改变 v0.5.0 的 Master 与官方播放优先级。
     * 数据源：首个视频文件行的 .file-opr 子节点。
     * 操作：
     * 1) 保留 Master、官方播放的原版顺序
     * 2) 把 ED2K 放在播放入口之后、原生下载之前
     */
    logger.info('开始核对旧版操作入口顺序')

    /** 1.1 Windows 回归环境没有 IINA，顺序应为两个原版播放入口、新增 ED2K、原生下载。 */
    await expect.poll(() => page.locator('li[iv="1"] .file-opr').first().locator(':scope > a').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('class') || node.getAttribute('menu')),
    )).toEqual(['master-player', '115-player', 'ed2k-link', 'download_one'])

    logger.info('旧版操作入口顺序核对完成')
    await ed2kBtn.click()
    const ed2kDialog = page.locator('[data-115master-ed2k-dialog]')
    await expect(ed2kDialog.locator('.name')).toHaveText('演示视频 01.mp4')
    await ed2kDialog.locator('button.cancel').click()
    await expect(ed2kDialog).toHaveCount(0)

    // 视频项注入封面容器（FileItemModVideoCover）：li 加类 + shadow 挂载点跟随主题
    await expect(page.locator('li.with-ext-video-cover')).toHaveCount(40)
    const coverRoot = page.locator('li.with-ext-video-cover .ext-video-cover-root').first()
    await expect(coverRoot).toBeAttached()
    await expect(coverRoot).toHaveAttribute('data-theme', 'light')

    // 文件夹 a 标签链接重写为可新标签打开的目录链接（FileItemModFolderLink）
    await expect(page.locator('li[title="动漫"] .file-name a'))
      .toHaveAttribute('href', 'https://115.com/?cid=1001&offset=0&tab=&mode=wangpan')
    await expect(page.locator('li[title="电影"] .file-name a'))
      .toHaveAttribute('href', 'https://115.com/?cid=1002&offset=0&tab=&mode=wangpan')

    // 非视频项（文件夹 / 文档）不注入播放按钮与封面
    await expect(page.locator('li[title="动漫"] a.master-player')).toHaveCount(0)
    await expect(page.locator('li[title="动漫"]')).not.toHaveClass(/with-ext-video-cover/)
    await expect(page.locator('li[title="说明文档.pdf"] a.master-player')).toHaveCount(0)
    await expect(page.locator('li[title="说明文档.pdf"]')).not.toHaveClass(/with-ext-video-cover/)

    expect(errors).toEqual([])
  })

  test('MutationObserver：列表重渲染后新增 li 被增量增强', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page)
    await page.goto(HOME_URL)
    await expect(page.locator('a.master-player')).toHaveCount(40)

    // 模拟官方列表整体重渲染：新增一个番号视频项 + 一个文件夹
    await replaceList(page, [
      { title: 'ABP-123 动态视频.mp4', iv: '1', file_type: '1', pick_code: 'dynamicVideoPick', sha1: 'DYNAMICSHA1' },
      { title: '动态文件夹', iv: '0', file_type: '0', pick_code: '', sha1: '', cate_id: '2001' },
    ])

    const video = page.locator('li[pick_code="dynamicVideoPick"]')
    await expect(video.locator('a.master-player')).toBeAttached()
    await expect(video).toHaveClass(/with-ext-info/)
    await expect(video.locator('.ext-info-root')).toBeAttached()
    await expect(page.locator('li[title="动态文件夹"] .file-name a'))
      .toHaveAttribute('href', 'https://115.com/?cid=2001&offset=0&tab=&mode=wangpan')
    // 旧列表项已被移除
    await expect(page.locator('li[title="动漫"]')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('MutationObserver：列表项移除后旧增强销毁、无泄漏报错', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page)
    await page.goto(HOME_URL)
    await expect(page.locator('li.with-ext-video-cover')).toHaveCount(40)

    // 重渲染为仅 1 项：43 个旧 itemModLoader 全部销毁
    await replaceList(page, [
      { title: '仅存视频.mp4', iv: '1', file_type: '1', pick_code: 'onlyOnePick', sha1: 'ONLYSHA1' },
    ])
    await expect(page.locator('.list-cell li')).toHaveCount(1)
    await expect(page.locator('li.with-ext-video-cover')).toHaveCount(1)
    await expect(page.locator('a.master-player')).toHaveCount(1)
    expect(errors).toEqual([])
  })

  test('网格模式：不注入扩展菜单与视频封面，文件夹链接仍重写', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: api => api.override(/^https:\/\/115\.com\/\?/, ({ route, request }) => {
        if (!request.isNavigationRequest())
          return
        return html(route, homeHtml({ view: 'grid' }))
      }),
    })
    await page.goto(HOME_URL)

    // extMenu / videoCover 在 grid 下跳过
    await expect(page.locator('li[title="动漫"]')).toBeAttached()
    await expect(page.locator('a.master-player')).toHaveCount(0)
    await expect(page.locator('a.ed2k-link')).toHaveCount(0)
    await expect(page.locator('li.with-ext-video-cover')).toHaveCount(0)
    // folderLink 不受视图模式限制
    await expect(page.locator('li[title="动漫"] .file-name a'))
      .toHaveAttribute('href', 'https://115.com/?cid=1001&offset=0&tab=&mode=wangpan')
    expect(errors).toEqual([])
  })

  test('融合版番号资料支持视频和 ISO 光盘镜像', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page)
    await page.goto(HOME_URL)

    /*
     * ================================================================================
     * 步骤1：验证视频和 ISO 番号资料
     * ================================================================================
     * 目标：番号 ISO 与视频能加载详情，软件 ISO 不产生误报。
     * 数据源：带标准番号的 MP4、ISO 以及 Windows 光盘镜像。
     * 操作：
     * 1) 注入两种文件并等待增强加载
     * 2) 核对详情容器与番号归属
     */
    logger.info('开始验证视频和 ISO 番号资料')

    // 1.1 注入带番号的视频和 ISO 文件
    await replaceList(page, [
      { title: 'ABP-123 番号视频.mp4', iv: '1', file_type: '1', pick_code: 'avNumberPick', sha1: 'AVSHA1' },
      { title: 'SORA-636.iso', iv: '1', file_type: '1', pick_code: 'isoPick', sha1: 'ISOSHA1' },
      { title: 'zh-cn_windows_11_consumer.iso', iv: '1', file_type: '1', pick_code: 'windowsIsoPick', sha1: 'WINDOWSISOSHA1' },
    ])
    const video = page.locator('li[pick_code="avNumberPick"]')
    const iso = page.locator('li[pick_code="isoPick"]')
    const windows = page.locator('li[pick_code="windowsIsoPick"]')

    // 1.2 两种文件都挂载各自的番号详情
    await expect(video.locator('a.master-player')).toBeAttached()
    await expect(video).toHaveClass(/with-ext-info/)
    await expect(video.locator('.ext-info-root')).toBeAttached()
    await expect(video).toHaveClass(/with-ext-video-cover/)
    await expect(video.locator('.ext-video-cover-root')).toBeAttached()
    await expect(iso).toHaveClass(/with-ext-info/)
    await expect(iso.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'SORA-636')
    await expect(iso.locator('.ext-info-root')).toBeAttached()
    await expect(windows).not.toHaveClass(/with-ext-info/)
    await expect(windows.locator('[data-115master-detail]')).toHaveCount(0)

    logger.info('视频和 ISO 番号资料验证完成')
    expect(errors).toEqual([])
  })

  test('旧版番号详情优先显示 DMM 实体横封套', async ({ page }) => {
    const errors = watch(page)
    const mono = 'https://pics.dmm.co.jp/mono/movie/abp123/abp123pl.jpg'
    const fallback = 'https://images.e2e.local/abp-123-fallback.png'
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/www\.javlibrary\.com\//, ({ route }) => {
          return route.fulfill({ status: 404, body: '' }).then(() => true as const)
        })
        api.override(/^https:\/\/www\.javbus\.com\/ABP-123/, ({ route }) => {
          return html(route, `
            <div class="container">
              <h3>ABP-123 实体横封套回归</h3>
              <div class="movie">
                <a class="bigImage"><img src="${fallback}"></a>
                <div class="info"><p><span class="header">識別碼:</span><span>ABP-123</span></p></div>
              </div>
            </div>
          `)
        })
        api.override(/^https:\/\/pics\.dmm\.co\.jp\/mono\/movie\/abp123\/abp123pl\.jpg/, async ({ route }) => {
          await route.fulfill({
            contentType: 'image/png',
            body: Buffer.concat([
              Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=', 'base64'),
              Buffer.alloc(4000),
            ]),
          })
          return true
        })
        api.override(/^https:\/\/(javdb\.com|missav\.ws)\//, ({ route }) => {
          return route.fulfill({ status: 404, body: '' }).then(() => true as const)
        })
      },
    })
    await page.goto(HOME_URL)

    /*
     * ================================================================================
     * 步骤1：核对实体横封套优先级
     * ================================================================================
     * 目标：DMM 实体图有效时直接显示，不访问 GraphQL 和原有封面图片。
     * 数据源：ABP-123 横版 PNG 和 JavBus 后备图地址。
     * 操作：
     * 1) 注入番号视频并等待封面显示
     * 2) 核对 GM 请求只命中实体横封套
     */
    logger.info('开始核对实体横封套优先级')

    // 1.1 注入一条拥有实体横封套的番号视频。
    await replaceList(page, [
      { title: 'ABP-123.mp4', iv: '1', file_type: '1', pick_code: 'monoCoverPick', sha1: 'MONOCOVERSHA1' },
    ])
    const cover = page.locator('li[pick_code="monoCoverPick"] [data-115master-detail] .ext-info-root img')
    await expect(cover).toBeVisible()

    /*
     * ================================================================================
     * 步骤2：核对旧版详情卡原版结构
     * ================================================================================
     * 目标：Fusion 数据源扩展不改变 v0.5.0 详情卡的字段、尺寸和浅色外观。
     * 数据源：ABP-123 已加载详情与 Shadow DOM 计算样式。
     * 操作：
     * 1) 核对来源行和浅色主题
     * 2) 核对原版卡片与封面尺寸
     */
    logger.info('开始核对旧版详情卡原版结构')

    /** 2.1 来源保留在原版第一列，链接指向本次融合采用的主资料源。 */
    const detail = page.locator('li[pick_code="monoCoverPick"] [data-115master-detail]')
    const root = detail.locator('.ext-info-root')
    const source = root.locator('[data-115master-detail-source]')
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(source).toHaveText('JavBus')
    await expect(source).toHaveAttribute('href', /^https:\/\/www\.javbus\.com\/?$/)

    /** 2.2 卡片、封面和列间距沿用 v0.5.0，封面来源选择仍使用 Fusion 的 DMM 优先逻辑。 */
    const card = root.locator(':scope > div')
    const coverBox = root.locator('a').first().locator('..')
    await expect(card).toHaveCSS('background-color', 'rgb(248, 248, 250)')
    await expect(card).toHaveCSS('border-radius', '16px')
    await expect(coverBox).toHaveCSS('width', '267.641px')
    await expect(coverBox).toHaveCSS('height', '180px')

    logger.info('旧版详情卡原版结构核对完成')

    /** 1.2 实体图成功后不再请求 FANZA 查询或 JavBus 后备图片。 */
    const requests = await gmRequests(page)
    expect(requests.some(request => request.url === mono)).toBe(true)
    expect(requests.some(request => request.url === 'https://api.video.dmm.co.jp/graphql')).toBe(false)
    expect(requests.some(request => request.url === fallback)).toBe(false)

    logger.info('实体横封套优先级核对完成')
    expect(errors).toEqual([])
  })

  test('旧版番号详情优先现有横封套而非 FANZA 数字竖图', async ({ page }) => {
    const errors = watch(page)
    const wide = 'https://images.e2e.local/abp-124-wide.png'
    const digital = 'https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/118abp00124/118abp00124pl.jpg'
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/www\.javlibrary\.com\//, ({ route }) => {
          return route.fulfill({ status: 404, body: '' }).then(() => true as const)
        })
        api.override(/^https:\/\/www\.javbus\.com\/ABP-124/, ({ route }) => {
          return html(route, `
            <div class="container">
              <h3>ABP-124 横封套优先回归</h3>
              <div class="movie">
                <a class="bigImage"><img src="${wide}"></a>
                <div class="info"><p><span class="header">識別碼:</span><span>ABP-124</span></p></div>
              </div>
            </div>
          `)
        })
        api.override(/^https:\/\/pics\.dmm\.co\.jp\/mono\/movie\//, async ({ route }) => {
          await route.fulfill({
            contentType: 'image/jpeg',
            body: Buffer.alloc(2732),
          })
          return true
        })
        api.override(/^https:\/\/api\.video\.dmm\.co\.jp\/graphql/, ({ route }) => {
          return json(route, {
            data: {
              legacySearchPPV: {
                result: {
                  contents: [{
                    id: '118abp00124',
                    title: 'ABP-124 FANZA 数字版',
                    packageImage: { largeUrl: digital },
                  }],
                },
              },
            },
          })
        })
        api.override(/^https:\/\/images\.e2e\.local\/abp-124-wide\.png/, async ({ route }) => {
          await route.fulfill({
            contentType: 'image/png',
            body: Buffer.concat([
              Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=', 'base64'),
              Buffer.alloc(4000),
            ]),
          })
          return true
        })
        api.override(/^https:\/\/(javdb\.com|missav\.ws)\//, ({ route }) => {
          return route.fulfill({ status: 404, body: '' }).then(() => true as const)
        })
      },
    })
    await page.goto(HOME_URL)

    /*
     * ================================================================================
     * 步骤1：核对跨来源横封套优先级
     * ================================================================================
     * 目标：DMM 实体图无效时，保留其他来源横封套，不降级成 FANZA 竖图。
     * 数据源：ABP-124 JavBus 横图、DMM 占位图和 FANZA 数字图地址。
     * 操作：
     * 1) 注入番号视频并等待横封套显示
     * 2) 核对横图已请求且数字竖图未请求
     */
    logger.info('开始核对跨来源横封套优先级')

    // 1.1 注入同时具备横封套和数字竖图的番号视频。
    await replaceList(page, [
      { title: 'ABP-124.mp4', iv: '1', file_type: '1', pick_code: 'wideFallbackPick', sha1: 'WIDEFALLBACKSHA1' },
    ])
    const cover = page.locator('li[pick_code="wideFallbackPick"] [data-115master-detail] .ext-info-root img')
    await expect(cover).toBeVisible()

    /** 1.2 真实横封套优先，FANZA 数字竖图不进入图片请求链。 */
    const requests = await gmRequests(page)
    expect(requests.some(request => request.url === wide)).toBe(true)
    expect(requests.some(request => request.url === digital)).toBe(false)

    logger.info('跨来源横封套优先级核对完成')
    expect(errors).toEqual([])
  })

  test('旧版番号详情用 FANZA 数字图回退 DMM 占位图', async ({ page }) => {
    const errors = watch(page)
    const queries: string[] = []
    const digital = 'https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1472hmdnv00767/h_1472hmdnv00767pl.jpg'
    const fallback = 'https://images.e2e.local/hmdnv-767-portrait.png'
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/www\.javlibrary\.com\//, ({ route }) => {
          return route.fulfill({ status: 404, body: '' }).then(() => true as const)
        })
        api.override(/^https:\/\/www\.javbus\.com\/HMDNV-767/, ({ route }) => {
          return html(route, `
            <div class="container">
              <h3>HMDNV-767 竖版封面回归</h3>
              <div class="movie">
                <a class="bigImage"><img src="${fallback}"></a>
                <div class="info"><p><span class="header">識別碼:</span><span>HMDNV-767</span></p></div>
              </div>
            </div>
          `)
        })
        api.override(/^https:\/\/pics\.dmm\.co\.jp\/mono\/movie\//, async ({ route }) => {
          await route.fulfill({
            contentType: 'image/jpeg',
            body: Buffer.alloc(2732),
          })
          return true
        })
        api.override(/^https:\/\/api\.video\.dmm\.co\.jp\/graphql/, ({ route, request }) => {
          const body = request.postDataJSON() as { variables?: { word?: string } }
          const word = body.variables?.word ?? ''
          queries.push(word)
          if (word === 'HMDNV-767') {
            return json(route, {
              data: { legacySearchPPV: { result: { contents: [] } } },
            })
          }
          return json(route, {
            data: {
              legacySearchPPV: {
                result: {
                  contents: [{
                    id: 'h_1472hmdnv00767',
                    title: 'HMDNV-767 竖版封面回归',
                    packageImage: { largeUrl: digital },
                  }],
                },
              },
            },
          })
        })
        api.override(/^https:\/\/awsimgsrc\.dmm\.co\.jp\/pics_dig\/digital\/video\/h_1472hmdnv00767\//, async ({ route }) => {
          await route.fulfill({
            contentType: 'image/png',
            body: Buffer.concat([
              Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEElEQVR42mP4z8DwH4QZGBgAHgQCAJXb5L8AAAAASUVORK5CYII=', 'base64'),
              Buffer.alloc(4000),
            ]),
          })
          return true
        })
        api.override(/^https:\/\/images\.e2e\.local\/hmdnv-767-portrait\.png/, async ({ route }) => {
          await route.fulfill({
            contentType: 'image/png',
            body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEElEQVR42mP4z8DwH4QZGBgAHgQCAJXb5L8AAAAASUVORK5CYII=', 'base64'),
          })
          return true
        })
        api.override(/^https:\/\/(javdb\.com|missav\.ws)\//, ({ route }) => {
          return route.fulfill({ status: 404, body: '' }).then(() => true as const)
        })
      },
    })
    await page.goto(HOME_URL)

    /*
     * ================================================================================
     * 步骤1：核对 FANZA 数字封面回退
     * ================================================================================
     * 目标：拒绝 DMM 占位图，并用现有详情标题找到官方数字竖图。
     * 数据源：2732B mono 占位图、FANZA GraphQL 和 HMDNV-767 数字图。
     * 操作：
     * 1) 注入番号视频并等待详情封面加载
     * 2) 核对标题回查顺序、图片来源和 contain 缩放
     */
    logger.info('开始核对 FANZA 数字封面回退')

    // 1.1 只保留一条竖版封面的番号视频。
    await replaceList(page, [
      { title: 'HMDNV-767.mp4', iv: '1', file_type: '1', pick_code: 'portraitCoverPick', sha1: 'PORTRAITCOVERSHA1' },
    ])
    const detail = page.locator('li[pick_code="portraitCoverPick"] [data-115master-detail]')
    const cover = detail.locator('.ext-info-root img')

    // 1.2 官方竖图完整缩放，原有 JavBus 图片不再请求。
    await expect(cover).toBeVisible()
    await expect(cover).toHaveCSS('object-fit', 'contain')
    await expect(cover).toHaveCSS('width', '267.641px')
    await expect(cover).toHaveCSS('height', '180px')
    expect(queries).toEqual(['HMDNV-767', '竖版封面回归'])
    const requests = await gmRequests(page)
    const fallbackIndex = requests.findIndex(request => request.url === fallback)
    const digitalIndex = requests.findIndex(request => request.url === digital)
    expect(fallbackIndex).toBeGreaterThan(-1)
    expect(digitalIndex).toBeGreaterThan(fallbackIndex)

    logger.info('FANZA 数字封面回退核对完成')
    expect(errors).toEqual([])
  })

  test('旧版大目录只挂载视口附近的视频预览', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page)
    await page.goto(HOME_URL)

    /*
     * ================================================================================
     * 步骤1：验证旧版大目录预览懒挂载
     * ================================================================================
     * 目标：开启预览时不同时创建数百个 Shadow DOM 和 Vue 应用。
     * 数据源：300 条固定高度的视频文件行。
     * 操作：
     * 1) 限定列表视口并注入 300 条视频
     * 2) 核对所有占位已建立，但仅视口附近挂载预览
     * 3) 滚到底部后核对末行按需挂载
     */
    console.info('[e2e] 开始核对旧版大目录预览懒挂载')

    await page.addStyleTag({
      content: '.list-contents { height: 320px !important; overflow-y: auto !important; } .list-contents li { height: 64px !important; min-height: 64px !important; overflow: hidden !important; }',
    })
    const videos = Array.from({ length: 300 }, (_, index) => ({
      title: `目录视频-${String(index + 1).padStart(3, '0')}.mp4`,
      iv: '1' as const,
      file_type: '1' as const,
      pick_code: `largeVideo${index + 1}`,
      sha1: String(index + 1).padStart(40, '0'),
    }))
    await replaceList(page, videos)

    await expect(page.locator('[data-115master-preview]')).toHaveCount(300)
    await expect.poll(() => page.locator('.ext-video-cover-root').count()).toBeLessThan(50)

    const scroll = page.locator('.list-contents')
    await scroll.evaluate(element => element.scrollTop = element.scrollHeight)
    await expect(page.locator('li[pick_code="largeVideo300"] .ext-video-cover-root')).toBeAttached()

    console.info('[e2e] 旧版大目录预览懒挂载核对完成')
    expect(errors).toEqual([])
  })

  test('旧版停用 MyFans 详情并保留 FC2 番号详情', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: api => api.override(/^https:\/\/115\.com\/\?/, ({ route, request }) => {
        if (!request.isNavigationRequest())
          return
        return html(route, homeHtml({
          paths: [
            { title: '根目录', cid: '0' },
            { title: 'fans', cid: '3' },
          ],
        }))
      }),
    })
    await page.goto(HOME_URL)

    /*
     * ================================================================================
     * 步骤1：核对旧版资料源边界
     * ================================================================================
     * 目标：MyFans 文件不再挂详情，FC2 文件继续挂载 FD2PPV 详情入口。
     * 数据源：旧版 fans 目录中的 MyFans、描述型和 FC2 视频。
     * 操作：
     * 1) 注入三类视频
     * 2) 核对 MyFans 隔离与 FC2 番号
     */
    console.info('[e2e] 开始核对旧版资料源边界')

    /** 1.1 注入显式 MyFans、描述型和 FC2 视频。 */
    await replaceList(page, [
      { title: 'ティアくん(tiakun_404)曾担任女性杂志专属模特。^WM10.mp4', iv: '1', file_type: '1', pick_code: 'myFansVideo', sha1: 'MYFANSSHA1' },
      { title: '75人目肉便器堕ち.restored.mp4', iv: '1', file_type: '1', pick_code: 'descriptionVideo', sha1: 'DESCRIPTIONSHA1' },
      { title: 'FC2-PPV-4818259.mp4', iv: '1', file_type: '1', pick_code: 'fc2Video', sha1: 'FC2SHA1' },
    ])

    /** 1.2 MyFans 和描述型文件不挂详情，FC2 保留标准番号详情。 */
    await expect(page.locator('li[pick_code="myFansVideo"] [data-115master-detail]')).toHaveCount(0)
    await expect(page.locator('li[pick_code="descriptionVideo"] [data-115master-detail]')).toHaveCount(0)
    await expect(page.locator('li[pick_code="fc2Video"] [data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'FC2-PPV-4818259')

    console.info('[e2e] 旧版资料源边界核对完成')
    expect(errors).toEqual([])
  })

  test('旧版演员头像保持小尺寸且不会撑满文件列表', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/fastly\.jsdelivr\.net\/gh\/gfriends\/gfriends[^/]*\/Filetree\.json/, ({ route }) =>
          json(route, {
            Content: {
              faces: {
                '一条みお.jpg': '一条みお.jpg?t=1',
              },
            },
          }))
      },
    })
    await page.goto(HOME_URL)

    /*
     * ================================================================================
     * 步骤1：核对旧版演员头像尺寸约束
     * ================================================================================
     * 目标：避免原始大图覆盖或撑高多行文件列表。
     * 数据源：旧版文件行、演员头像索引和头像节点计算样式。
     * 操作：
     * 1) 注入与演员名完全匹配的旧版文件夹行
     * 2) 核对状态类归属、头像尺寸和文件行高度
     */
    console.info('[e2e] 开始核对旧版演员头像尺寸')

    /** 1.1 注入与演员头像索引完全匹配的旧版文件行。 */
    await replaceList(page, [
      { title: '一条みお', iv: '0', file_type: '0', pick_code: '', sha1: '', cate_id: 'actress-folder' },
    ])

    /** 1.2 状态类属于文件行，头像保持 50 x 50，文件行不会被原图撑高。 */
    const row = page.locator('li[title="一条みお"]')
    const avatar = row.locator('[data-115master-actress]')
    await expect(row).toHaveClass(/with-actress-info/)
    await expect(avatar).toHaveCSS('width', '50px')
    await expect(avatar).toHaveCSS('height', '50px')
    await expect(avatar).toHaveCSS('border-radius', '50%')
    await expect(avatar).toHaveCSS('border-top-color', 'rgb(241, 241, 241)')
    await expect(avatar).toHaveCSS('background-color', 'rgb(241, 241, 241)')
    await expect(avatar).toHaveCSS('object-fit', 'cover')
    await expect.poll(async () => row.evaluate(element =>
      element.getBoundingClientRect().height,
    )).toBeLessThanOrEqual(120)

    console.info('[e2e] 旧版演员头像尺寸核对完成')
    expect(errors).toEqual([])
  })
})

test.describe('FileItemMod 交互', () => {
  test('双击视频项：跳转 Master 播放器', async ({ page }) => {
    const errors = watch(page)
    const tabs = watchTabs(page)
    await setupHarness(page)
    await page.goto(HOME_URL)

    const video = page.locator('li[iv="1"]').first()
    const pickCode = await video.getAttribute('pick_code')
    await video.dblclick()

    // goToPlayer：GM_setValue 记录播放信息 + GM_openInTab 打开 master 视频页
    await expect.poll(async () => {
      const store = await gmStore(page)
      return (store.playingVideoInfo as { pickCode?: string } | undefined)?.pickCode
    }).toBe(pickCode)
    await expect.poll(() => tabs.length).toBeGreaterThan(0)
    expect(tabs[0]).toBe(`https://115.com/web/lixian/master/#/video/${pickCode}`)
    expect(errors).toEqual([])
  })

  test('中键点击视频项：打开 115 官方播放页', async ({ page }) => {
    const errors = watch(page)
    const tabs = watchTabs(page)
    await setupHarness(page)
    await page.goto(HOME_URL)

    const video = page.locator('li[iv="1"]').first()
    const pickCode = await video.getAttribute('pick_code')
    await video.dispatchEvent('auxclick', { button: 1 })

    await expect.poll(() => tabs.length).toBeGreaterThan(0)
    expect(tabs[0]).toBe(`https://115vod.com/?pickcode=${pickCode}&share_id=0`)
    expect(errors).toEqual([])
  })

  test('扩展菜单按钮：Master 播放 / 官方播放分别跳转对应播放器', async ({ page }) => {
    const errors = watch(page)
    const tabs = watchTabs(page)
    await setupHarness(page)
    await page.goto(HOME_URL)

    const video = page.locator('li[iv="1"]').first()
    const pickCode = await video.getAttribute('pick_code')

    // 按钮通过 mousedown 触发
    await video.locator('a.master-player').click()
    await expect.poll(async () => {
      const store = await gmStore(page)
      return (store.playingVideoInfo as { pickCode?: string } | undefined)?.pickCode
    }).toBe(pickCode)
    expect(tabs[0]).toBe(`https://115.com/web/lixian/master/#/video/${pickCode}`)

    await video.locator('a[class="115-player"]').click()
    await expect.poll(() => tabs.length).toBe(2)
    expect(tabs[1]).toBe(`https://115vod.com/?pickcode=${pickCode}&share_id=0`)
    expect(errors).toEqual([])
  })

  test('文件下载按钮：获取下载地址并新窗口打开', async ({ page }) => {
    const errors = watch(page)
    const fileUrl = 'https://cdnfhnfile.115cdn.net/e2e/download.mp4'
    const requested: (string | null)[] = []
    // Pro 接口默认 mock 固定失败 → 走 webapi 兜底，这里覆盖兜底接口给出下载地址
    await setupHarness(page, {
      mocks: api => api.override(/^https:\/\/webapi\.115\.com\/files\/download/, ({ route, url }) => {
        requested.push(url.searchParams.get('pickcode'))
        return json(route, { state: true, file_url: fileUrl })
      }),
    })
    await page.addInitScript(() => {
      (window as unknown as { __opened: string[] }).__opened = []
      window.open = (url) => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url))
        return null
      }
    })
    await page.goto(HOME_URL)

    const video = page.locator('li[iv="1"]').first()
    const pickCode = await video.getAttribute('pick_code')
    // 官方下载按钮为无内容的空 a 标签（无 CSS 时不可见），直接派发 click 触发 onclick
    await video.locator('a[menu="download_one"]').dispatchEvent('click')

    await expect.poll(() => requested.length).toBeGreaterThan(0)
    expect(requested[0]).toBe(pickCode)
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { __opened: string[] }).__opened),
    ).toContain(fileUrl)
    expect(errors).toEqual([])
  })

  test('文件夹下载按钮：非115Browser给出明确环境提示', async ({ page }) => {
    const errors = watch(page)
    const dialogs: string[] = []
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message())
      dialog.dismiss()
    })
    await setupHarness(page)
    await page.goto(HOME_URL)

    // 同上：空 a 标签不可见，直接派发 click
    await page.locator('li[title="动漫"] a[menu="download_dir_one"]').dispatchEvent('click')
    await expect.poll(() => dialogs).toEqual(['文件夹下载需要 115Browser'])
    expect(errors).toEqual([])
  })

  /**
   * ============================================================================
   * 步骤8：验证 ED2K 批次诊断数据
   * ============================================================================
   * 目标：真实弹窗完成 Range 和 MD4 后向测试桥暴露短诊断序列。
   * 数据源：100 字节离线视频、临时下载地址和标准 206 响应。
   * 操作：
   * 1) 替换列表并生成 ED2K 链
   * 2) 核对批次速度、哈希耗时和尝试次数
   * 3) 核对地址数与 Worker 路径
   */
  test('ED2K 完成后向测试桥暴露批次诊断数据', async ({ page }) => {
    const errors = watch(page)
    const fileUrl = 'https://cdnfhnfile.115cdn.net/home-ed2k-diagnostic.mp4'
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/webapi\.115\.com\/files\/download/, ({ route }) => (
          json(route, { state: true, file_url: fileUrl })
        ))
        api.override(/^https:\/\/cdnfhnfile\.115cdn\.net\/home-ed2k-diagnostic\.mp4/, async ({ route, request }) => {
          expect(request.headers().range).toBe('bytes=0-99')
          await route.fulfill({
            status: 206,
            headers: {
              ...CORS,
              'access-control-expose-headers': 'Content-Range',
              'content-range': 'bytes 0-99/100',
            },
            body: Buffer.alloc(100),
          })
          return true
        })
      },
    })
    await page.goto(HOME_URL)
    await replaceList(page, [{
      title: 'ED2K 诊断.mp4',
      iv: '1',
      file_type: '1',
      pick_code: 'diagnosticPick',
      sha1: 'DIAGNOSTICSHA1',
    }])
    logger.info('开始验证 ED2K 批次诊断数据')

    // 8.1 启动小文件任务并等待真实结果弹窗
    await page.locator('a.ed2k-link').click()
    const host = page.locator('[data-115master-ed2k-dialog]')
    await expect(host.locator('h2')).toHaveText('ED2K 链已生成')

    // 8.2 单批次必须记录速度、哈希耗时和一次成功尝试
    await expect(host).toHaveAttribute('data-ed2k-batches', '1/1')
    await expect(host).toHaveAttribute('data-ed2k-download-mbps', /\d/)
    await expect(host).toHaveAttribute('data-ed2k-hash-ms', /^\d+$/)
    await expect(host).toHaveAttribute('data-ed2k-attempts', '1')

    // 8.3 首次地址解析只出现一次，Worker 状态必须明确可读
    await expect(host).toHaveAttribute('data-ed2k-addresses', '1')
    await expect(host).toHaveAttribute('data-ed2k-worker', /^(main|worker)$/)
    expect(errors).toEqual([])
    logger.info('ED2K 批次诊断数据验证完成')
  })
})
