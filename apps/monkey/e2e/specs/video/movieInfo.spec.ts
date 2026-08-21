import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { CORS, gmRequests, setupHarness } from '../../support'
import { installVideoMocks, JAV_EPISODE, videoUrl, watch } from './support'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

/** 播放器详情图片：GM 加载、缩略图优先和失败网格收缩。 */
test.describe('播放器影片详情图片', () => {
  test('JavDB 演员头像和剧照使用 GM 图片链并隐藏失败剧照', async ({ page }) => {
    const errors = watch(page)
    const images: string[] = []
    await setupHarness(page, {
      mocks: (api) => {
        installVideoMocks(api, { episode: JAV_EPISODE })
        api.override(/^https:\/\/javdb\.com\/search/, async ({ route }) => {
          await route.fulfill({
            body: '<div class="movie-list"><div class="item"><a href="/v/jac089"><span class="video-title"><strong>JAC-089</strong></span></a></div></div>',
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/javdb\.com\/v\/jac089/, async ({ route }) => {
          await route.fulfill({
            body: `
              <div class="current-title">JAC-089 图片回归</div>
              <div class="container">
                <div class="panel-block"><strong>番號:</strong><span class="value">JAC-089</span></div>
                <div class="panel-block"><strong>演員:</strong><span class="value"><a href="/actors/ABCD1234">测试演员</a><span class="female"></span></span></div>
              </div>
              <div class="preview-images">
                <a class="tile-item" href="https://images.e2e.local/raw-ok.jpg"><img src="https://images.e2e.local/thumb-ok.jpg"></a>
                <a class="tile-item" href="https://images.e2e.local/raw-fallback.jpg"><img src="https://images.e2e.local/thumb-fallback.jpg"></a>
                <a class="tile-item" href="https://images.e2e.local/raw-native.jpg"><img src="https://images.e2e.local/thumb-native.jpg"></a>
                <a class="tile-item" href="https://images.e2e.local/raw-failed.jpg"><img src="https://images.e2e.local/thumb-failed.jpg"></a>
              </div>
            `,
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/www\.javbus\.com\/JAC-089/, async ({ route }) => {
          await route.fulfill({
            body: `
              <div class="container">
                <h3>JAC-089 E2E</h3>
                <div class="movie">
                  <div class="info">
                    <p><span class="header">識別碼:</span><span>JAC-089</span></p>
                    <p><span class="header">演員:</span></p>
                    <ul><li><a href="/star/test"><img title="测试演员" src="https://pics.dmm.co.jp/mono/actjpgs/test.jpg"></a></li></ul>
                  </div>
                  <div id="sample-waterfall">
                    <a href="https://images.e2e.local/bus-raw-1.jpg"><img src="https://images.e2e.local/bus-thumb-1.jpg"></a>
                    <a href="https://images.e2e.local/bus-raw-2.jpg"><img src="https://images.e2e.local/bus-thumb-2.jpg"></a>
                    <a href="https://images.e2e.local/bus-raw-3.jpg"><img src="https://images.e2e.local/bus-thumb-3.jpg"></a>
                    <a href="https://images.e2e.local/bus-raw-4.jpg"><img src="https://images.e2e.local/bus-thumb-4.jpg"></a>
                  </div>
                </div>
              </div>
            `,
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/www\.javlibrary\.com\/cn\/vl_searchbyid\.php/, async ({ route }) => {
          await route.fulfill({
            body: '<html><head><title>JAC-089 - JAVLibrary</title></head><body><div id="video_title">JAC-089 E2E</div><div id="video_info"><div id="video_id"><span class="text">JAC-089</span></div></div></body></html>',
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/api\.video\.dmm\.co\.jp\/graphql/, async ({ route }) => {
          await route.fulfill({
            contentType: 'application/json',
            headers: CORS,
            json: {
              data: {
                legacySearchPPV: {
                  result: {
                    contents: [{
                      id: 'e2ejac00089',
                      title: 'JAC-089 图片回归',
                      packageImage: {
                        largeUrl: 'https://images.e2e.local/fanza-cover.jpg',
                      },
                    }],
                  },
                },
              },
            },
          })
          return true
        })
        api.override(/^https:\/\/(?:pics\.dmm\.co\.jp\/digital|awsimgsrc\.dmm\.co\.jp\/pics_dig\/digital)\/video\//, async ({ route, url }) => {
          images.push(url.href)
          if (url.href === 'https://pics.dmm.co.jp/digital/video/e2ejac00089/e2ejac00089jp-1.jpg') {
            await route.fulfill({
              contentType: 'image/png',
              body: Buffer.concat([
                Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=', 'base64'),
                Buffer.alloc(6000),
              ]),
              headers: CORS,
            })
            return true
          }
          await route.fulfill({ status: 403, body: 'unavailable', headers: CORS })
          return true
        })
        api.override(/^https:\/\/c0\.jdbstatic\.com\/avatars\//, async ({ route, url }) => {
          images.push(url.href)
          await route.fulfill({ status: 403, body: 'forbidden', headers: CORS })
          return true
        })
        api.override(/^https:\/\/pics\.dmm\.co\.jp\/mono\/actjpgs\//, async ({ route, url }) => {
          images.push(url.href)
          await route.fulfill({ body: PNG, contentType: 'image/png', headers: CORS })
          return true
        })
        api.override(/^https:\/\/images\.e2e\.local\//, async ({ route, url }) => {
          images.push(url.href)
          const referer = (await route.request().allHeaders()).referer
          const gmOnlyFailure = url.pathname.includes('native') && Boolean(referer)
          const unavailableBusPreview = /bus-(?:thumb|raw)-3/.test(url.pathname)
          if (url.pathname.includes('failed') || url.pathname.includes('thumb-fallback') || gmOnlyFailure || unavailableBusPreview) {
            await route.fulfill({ status: 403, body: 'forbidden', headers: CORS })
            return true
          }
          await route.fulfill({ body: PNG, contentType: 'image/png', headers: CORS })
          return true
        })
      },
    })
    await page.goto(videoUrl(JAV_EPISODE.pc))

    /*
     * ================================================================================
     * 步骤1：验证播放器详情图片链
     * ================================================================================
     * 目标：优先显示官方高清图，放大层复用 Blob，失败剧照不保留空白格。
     * 数据源：一张 FANZA/DMM 官方剧照、资料源回退图和一张 403 剧照。
     * 操作：
     * 1) 等待 JavDB 详情与图片请求完成
     * 2) 核对官方图优先、原图回退和失败剧照隐藏
     * 3) 点击剧照后核对 PhotoSwipe 不再直连外站
     */
    console.info('[e2e] 开始核对播放器详情图片链')

    await expect(page.getByText('JAC-089 图片回归', { exact: true })).toBeVisible()
    const actor = page.getByRole('img', { name: '测试演员' })
    await expect(actor).toBeVisible()
    await expect(actor).toHaveAttribute('src', /^blob:/)
    expect(images).toContain('https://c0.jdbstatic.com/avatars/ab/ABCD1234.jpg')
    expect(images).toContain('https://pics.dmm.co.jp/mono/actjpgs/test.jpg')
    const actorImageRequest = (await gmRequests(page))
      .find(request => request.url === 'https://pics.dmm.co.jp/mono/actjpgs/test.jpg')
    expect(actorImageRequest?.headers.Referer).toBe('https://www.javbus.com/star/test')

    const valid = page.locator('a[href="https://images.e2e.local/raw-ok.jpg"]')
    const gmFallback = page.locator('a[href="https://images.e2e.local/raw-fallback.jpg"]')
    const nativeFallback = page.locator('a[href="https://images.e2e.local/raw-native.jpg"]')
    const crossSourceFallback = page.locator('a[href="https://images.e2e.local/raw-failed.jpg"]')
    await valid.scrollIntoViewIfNeeded()
    await expect(valid).toBeVisible()
    await expect(valid.locator('img')).toHaveAttribute('data-origin-src', 'https://images.e2e.local/raw-ok.jpg')
    await expect(valid.locator('img')).toHaveAttribute('src', /^blob:/)
    await expect(gmFallback).toBeVisible()
    await expect(gmFallback.locator('img')).toHaveAttribute('src', /^blob:/)
    await expect(nativeFallback).toBeVisible()
    await expect(nativeFallback.locator('img')).toHaveAttribute('src', 'https://images.e2e.local/raw-native.jpg')
    await expect(crossSourceFallback).toBeVisible()
    await expect(crossSourceFallback.locator('img'))
      .toHaveAttribute('src', /^blob:/)
    expect(images).toContain('https://pics.dmm.co.jp/digital/video/e2ejac00089/e2ejac00089jp-1.jpg')
    expect(images).toContain('https://images.e2e.local/raw-fallback.jpg')
    expect(images).toContain('https://images.e2e.local/raw-native.jpg')
    expect(images).toContain('https://images.e2e.local/raw-failed.jpg')
    expect(images).toContain('https://images.e2e.local/bus-raw-4.jpg')
    expect(images).not.toContain('https://images.e2e.local/thumb-ok.jpg')
    expect(images).not.toContain('https://images.e2e.local/raw-ok.jpg')

    /** 1.3 PhotoSwipe 使用当前 Image 组件已加载的 Blob，不请求 a.href 的远程原图。 */
    await valid.click()
    await expect(page.locator('.pswp')).toHaveClass(/pswp--open/)
    await expect(page.locator('.pswp__img')).toHaveAttribute('src', /^blob:/)
    await page.keyboard.press('Escape')

    console.info('[e2e] 播放器详情图片链核对完成')
    expect(errors).toEqual([])
  })

  test('现有头像全部失败后按需使用 MissAV 演员页头像', async ({ page }) => {
    const errors = watch(page)
    const episode = {
      pc: 'e2enmsl04500vid',
      n: 'NMSL-045.mp4',
      fid: '910000000000000045',
    }
    await setupHarness(page, {
      mocks: (api) => {
        installVideoMocks(api, { episode })
        api.override(/^https:\/\/javdb\.com\/search/, async ({ route }) => {
          await route.fulfill({
            body: '<div class="movie-list"><div class="item"><a href="/v/nmsl045"><span class="video-title"><strong>NMSL-045</strong></span></a></div></div>',
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/javdb\.com\/v\/nmsl045/, async ({ route }) => {
          await route.fulfill({
            body: `
              <div class="current-title">NMSL-045 MissAV 头像回归</div>
              <div class="container">
                <div class="panel-block"><strong>番號:</strong><span class="value">NMSL-045</span></div>
                <div class="panel-block"><strong>演員:</strong><span class="value"><a href="/actors/WQYOE">藤田ゆず</a><span class="female"></span></span></div>
              </div>
            `,
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/www\.javbus\.com\/NMSL-045/, async ({ route }) => {
          await route.fulfill({
            body: '<div class="container"><h3>NMSL-045</h3><div class="movie"><div class="info"><p><span class="header">識別碼:</span><span>NMSL-045</span></p></div></div></div>',
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/www\.javlibrary\.com\/cn\/vl_searchbyid\.php/, async ({ route }) => {
          await route.fulfill({
            body: '<html><head><title>NMSL-045 - JAVLibrary</title></head><body><div id="video_title">NMSL-045</div><div id="video_info"><div id="video_id"><span class="text">NMSL-045</span></div></div></body></html>',
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/fastly\.jsdelivr\.net\/gh\/gfriends\/gfriends@latest\/Filetree\.json/, async ({ route }) => {
          await route.fulfill({
            body: JSON.stringify({
              Content: {},
              Information: { Timestamp: 1, TotalNum: 0, TotalSize: 0 },
            }),
            contentType: 'application/json; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/missav\.ws\/cn\/NMSL-045/, async ({ route }) => {
          await route.fulfill({
            body: `
              <title>NMSL-045 MissAV - MissAV</title>
              <meta property="og:title" content="NMSL-045 MissAV">
              <meta property="og:image" content="https://fourhoi.com/nmsl-045/cover-n.jpg">
              <div class="space-y-2"><div><span>女优:</span><a href="/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A">藤田柚子</a></div></div>
            `,
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/missav\.ws\/dm26\/actresses\//, async ({ route }) => {
          await route.fulfill({
            body: `
              <title>藤田ゆず出演的 AV 在线看 - MissAV</title>
              <link rel="canonical" href="https://missav.ws/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A">
              <meta property="og:image" content="http://pics.dmm.co.jp/mono/actjpgs/fujita_yuzu.jpg">
            `,
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/c0\.jdbstatic\.com\/avatars\//, async ({ route }) => {
          await route.fulfill({ status: 403, body: 'forbidden', headers: CORS })
          return true
        })
        api.override(/^https:\/\/pics\.dmm\.co\.jp\/mono\/actjpgs\/fujita_yuzu\.jpg/, async ({ route }) => {
          await route.fulfill({ body: PNG, contentType: 'image/png', headers: CORS })
          return true
        })
      },
    })
    await page.goto(videoUrl(episode.pc))

    /*
     * ================================================================================
     * 步骤1：验证 MissAV 头像按需回退
     * ================================================================================
     * 目标：JavDB 和 JavBus 均无可用头像时自动补 MissAV，不增加可见资料标签。
     * 数据源：失败的 JavDB 头像、MissAV 影片演员链接和演员页头像。
     * 操作：
     * 1) 等待现有头像链失败并触发 MissAV
     * 2) 核对头像、Cookie 分区和标签数量
     */
    console.info('[e2e] 开始核对 MissAV 演员头像回退')

    await expect(page.getByText('NMSL-045 MissAV 头像回归', { exact: true })).toBeVisible()
    const actor = page.locator('img[alt="藤田ゆず"]')
    await expect(actor).toHaveAttribute('src', /^blob:/)
    await expect(page.getByText('MissAV', { exact: true })).toHaveCount(0)
    const requests = await gmRequests(page)
    expect(requests.find(request => request.url === 'https://missav.ws/cn/NMSL-045')?.cookiePartition)
      .toEqual({ topLevelSite: 'https://missav.ws' })
    expect(requests.find(request => request.url.includes('/dm26/actresses/'))?.cookiePartition)
      .toEqual({ topLevelSite: 'https://missav.ws' })
    expect(requests.find(request => request.url === 'https://pics.dmm.co.jp/mono/actjpgs/fujita_yuzu.jpg')?.headers.Referer)
      .toContain('missav.ws/dm26/actresses/')

    console.info('[e2e] MissAV 演员头像回退核对完成')
    expect(errors).toEqual([])
  })

  test('文件列表 gfriends 头像优先于可用的 JavDB 头像', async ({ page }) => {
    const errors = watch(page)
    const episode = {
      pc: 'e2egfriends045vid',
      n: 'NMSL-045.mp4',
      fid: '920000000000000045',
    }
    await setupHarness(page, {
      mocks: (api) => {
        installVideoMocks(api, { episode })
        api.override(/^https:\/\/javdb\.com\/search/, async ({ route }) => {
          await route.fulfill({
            body: '<div class="movie-list"><div class="item"><a href="/v/nmsl045-gfriends"><span class="video-title"><strong>NMSL-045</strong></span></a></div></div>',
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/javdb\.com\/v\/nmsl045-gfriends/, async ({ route }) => {
          await route.fulfill({
            body: `
              <div class="current-title">NMSL-045 gfriends 头像回归</div>
              <div class="container">
                <div class="panel-block"><strong>番號:</strong><span class="value">NMSL-045</span></div>
                <div class="panel-block"><strong>演員:</strong><span class="value"><a href="/actors/WQYOE">藤田ゆず</a><span class="female"></span></span></div>
              </div>
            `,
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/www\.javbus\.com\/NMSL-045/, async ({ route }) => {
          await route.fulfill({
            body: `
              <div class="container">
                <h3>NMSL-045 JavBus gfriends 头像回归</h3>
                <div class="movie">
                  <div class="info">
                    <p><span class="header">識別碼:</span><span>NMSL-045</span></p>
                    <p><span class="header">演員:</span></p>
                    <ul><li><a href="/star/yuzu"><img src="https://images.e2e.local/javbus-yuzu.jpg" title="藤田ゆず"></a></li></ul>
                  </div>
                </div>
              </div>
            `,
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/www\.javlibrary\.com\/cn\/vl_searchbyid\.php/, async ({ route }) => {
          await route.fulfill({
            body: `
              <html>
                <head><title>NMSL-045 JavLibrary gfriends 头像回归 - JAVLibrary</title></head>
                <body>
                  <div id="video_title"><h3>NMSL-045 JavLibrary gfriends 头像回归</h3></div>
                  <div id="video_info">
                    <div id="video_id"><span class="text">NMSL-045</span></div>
                    <div id="video_cast"><span class="cast"><span class="star"><a href="vl_star.php?s=yuzu">藤田ゆず</a></span></span></div>
                  </div>
                </body>
              </html>
            `,
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/fastly\.jsdelivr\.net\/gh\/gfriends\/gfriends@latest\/Filetree\.json/, async ({ route }) => {
          await route.fulfill({
            body: JSON.stringify({
              Content: {
                '7-Moodyz': {
                  '藤田ゆず.jpg': '藤田ゆず.jpg?t=1759792631',
                },
              },
              Information: { Timestamp: 1759792631, TotalNum: 1, TotalSize: PNG.length },
            }),
            contentType: 'application/json; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/fastly\.jsdelivr\.net\/gh\/gfriends\/gfriends@latest\/Content\//, async ({ route }) => {
          await route.fulfill({ body: PNG, contentType: 'image/jpeg', headers: CORS })
          return true
        })
        api.override(/^https:\/\/missav\.ws\/(?:cn\/NMSL-045|search\/)/, async ({ route }) => {
          await route.fulfill({
            body: '<html><head><title>NMSL-045 - MissAV</title></head><body></body></html>',
            contentType: 'text/html; charset=utf-8',
            headers: CORS,
          })
          return true
        })
        api.override(/^https:\/\/c0\.jdbstatic\.com\/avatars\//, async ({ route }) => {
          await route.fulfill({ body: PNG, contentType: 'image/png', headers: CORS })
          return true
        })
      },
    })
    await page.goto(videoUrl(episode.pc))

    /*
     * ================================================================================
     * 步骤1：验证 gfriends 头像主选
     * ================================================================================
     * 目标：JavDB 头像可用时，播放器仍先显示 gfriends 已收录头像。
     * 数据源：三个资料源的藤田ゆず记录和 gfriends 主选头像。
     * 操作：
     * 1) 等待演员名触发 gfriends 主选加载
     * 2) 循环切换三个资料源，核对头像始终来自 gfriends
     * 3) 确认 gfriends 命中后没有发出 MissAV 请求
     */
    console.info('[e2e] 开始核对 gfriends 演员头像主选')

    await expect(page.getByText('NMSL-045 gfriends 头像回归', { exact: true })).toBeVisible()
    const actor = page.locator('img[alt="藤田ゆず"]')
    await expect(actor).toHaveAttribute('src', /^blob:/)
    await expect(actor).toHaveAttribute('data-origin-src', /gfriends\/gfriends@latest\/Content\/7-Moodyz\//)
    for (const source of ['JavBus', 'JavLibrary', 'JavDB']) {
      // 1.1 每个资料标签都必须保留同一个 gfriends 主选头像。
      await page.locator('a.tab', { hasText: source }).click()
      await expect(page.locator('a.tab-active')).toHaveText(source)
      await expect(actor).toHaveAttribute('data-origin-src', /gfriends\/gfriends@latest\/Content\/7-Moodyz\//)
    }
    const requests = await gmRequests(page)
    expect(requests.some(request => request.url.includes('gfriends/gfriends@latest/Content/7-Moodyz/')))
      .toBe(true)
    expect(requests.some(request => request.url.includes('missav.ws'))).toBe(false)

    console.info('[e2e] gfriends 演员头像主选核对完成')
    expect(errors).toEqual([])
  })
})
