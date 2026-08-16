/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { publishFusionUpdate, startBridgeServer } from './bridge.mjs'

const logger = {
  info: (...messages) => console.info('[115Master Bridge Test]', ...messages),
}

/** 向测试控制端发送带令牌的 JSON 请求。 */
async function request(bridge, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${bridge.port}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-115Master-Bridge-Token': bridge.token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return {
    status: response.status,
    value: text ? JSON.parse(text) : null,
  }
}

test('queues one command for the selected live browser client', async () => {
  /*
   * ================================================================================
   * 步骤1：注册模拟浏览器标签页
   * ================================================================================
   * 目标：验证正常浏览器轮询协议无需 CDP 端点。
   * 数据源：临时回环端口和模拟客户端摘要。
   * 操作：
   * 1) 启动控制端并上报标签页
   * 2) 核对控制端可列出该标签页
   */
  logger.info('开始注册模拟浏览器标签页')

  const bridge = await startBridgeServer({
    port: 0,
    token: 'a'.repeat(64),
    timeoutMs: 5_000,
  })
  try {
    const firstPoll = await request(bridge, '/v1/poll', {
      clientId: 'client-new-page',
      page: { url: 'https://115.com/storage/allfiles', title: '字幕' },
    })
    assert.equal(firstPoll.status, 204)

    const clients = await request(bridge, '/v1/admin/clients')
    assert.equal(clients.status, 200)
    assert.equal(clients.value.clients[0].id, 'client-new-page')
    logger.info('模拟浏览器标签页注册完成')

    /*
     * ================================================================================
     * 步骤2：完成命令与结果闭环
     * ================================================================================
     * 目标：验证控制命令只到达选中标签页，结果可返回管理调用方。
     * 数据源：status 命令和模拟浏览器结果。
     * 操作：
     * 1) 异步提交命令后由浏览器下一轮领取
     * 2) 回传结果并核对命令调用结束
     */
    logger.info('开始验证浏览器命令闭环')

    const pendingAdmin = request(bridge, '/v1/admin/command', {
      target: { urlContains: '/storage/allfiles' },
      type: 'status',
      payload: {},
    })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))

    const commandPoll = await request(bridge, '/v1/poll', {
      clientId: 'client-new-page',
      page: { url: 'https://115.com/storage/allfiles', title: '字幕' },
    })
    assert.equal(commandPoll.status, 200)
    assert.equal(commandPoll.value.command.type, 'status')

    const result = await request(bridge, '/v1/result', {
      clientId: 'client-new-page',
      commandId: commandPoll.value.command.id,
      ok: true,
      value: { fusion: { detailCount: 20 } },
    })
    assert.equal(result.status, 200)

    const admin = await pendingAdmin
    assert.equal(admin.status, 200)
    assert.equal(admin.value.ok, true)
    assert.equal(admin.value.value.fusion.detailCount, 20)
    logger.info('浏览器命令闭环验证完成')
  }
  finally {
    await bridge.close()
  }
})

test('serves public update metadata without exposing controller commands', async () => {
  /*
   * ================================================================================
   * 步骤1：读取测试桥本地更新端点
   * ================================================================================
   * 目标：验证 Tampermonkey 无需控制令牌即可检查版本。
   * 数据源：测试桥源码和临时回环端口。
   * 操作：
   * 1) 请求 meta.js 并确认不包含运行代码
   * 2) 请求受保护端点并确认仍需令牌
   */
  logger.info('开始验证本地用户脚本更新端点')

  const bridge = await startBridgeServer({ port: 0, token: 'b'.repeat(64) })
  try {
    const metadataResponse = await fetch(
      `http://127.0.0.1:${bridge.port}/updates/bridge.meta.js`,
    )
    const metadata = await metadataResponse.text()
    assert.equal(metadataResponse.status, 200)
    assert.match(metadata, /@version\s+0\.2\.14/)
    assert.match(metadata, /@updateURL\s+http:\/\/127\.0\.0\.1:11531/)
    assert.doesNotMatch(metadata, /\(function \(\)/)

    const protectedResponse = await fetch(
      `http://127.0.0.1:${bridge.port}/v1/admin/clients`,
    )
    assert.equal(protectedResponse.status, 401)
    logger.info('本地用户脚本更新端点验证完成')
  }
  finally {
    await bridge.close()
  }
})

test('keeps a throttled background tab eligible for sixty seconds', async () => {
  /*
   * ================================================================================
   * 步骤1：模拟后台标签页计时器节流
   * ================================================================================
   * 目标：一分钟没有轮询时，控制端仍能找到后台 115 标签页。
   * 数据源：固定系统时间、模拟客户端摘要和客户端列表端点。
   * 操作：
   * 1) 注册一次标签页轮询
   * 2) 时间推进六十秒后复查在线资格
   */
  logger.info('开始验证后台标签页存活窗口')

  const originalNow = Date.now
  let currentTime = 1_786_866_000_000
  Date.now = () => currentTime
  const bridge = await startBridgeServer({ port: 0, token: 'c'.repeat(64) })
  try {
    const poll = await request(bridge, '/v1/poll', {
      clientId: 'client-background-page',
      page: { url: 'https://115.com/storage/allfiles', title: 'fans' },
    })
    assert.equal(poll.status, 204)

    // 1.1 Chromium 后台标签页可能约一分钟后才进入下一轮。
    currentTime += 60_000
    const clients = await request(bridge, '/v1/admin/clients')
    assert.equal(clients.status, 200)
    assert.equal(clients.value.clients[0].id, 'client-background-page')
    logger.info('后台标签页存活窗口验证完成')
  }
  finally {
    Date.now = originalNow
    await bridge.close()
  }
})

test('reads Fusion state inside a visible same-origin iframe', () => {
  /*
   * ================================================================================
   * 步骤1：构造旧版 115 同源 iframe
   * ================================================================================
   * 目标：验证 @noframes 测试桥可从顶层读取旧版文件 iframe。
   * 数据源：JSDOM 顶层页面、同源 iframe、详情与预览节点。
   * 操作：
   * 1) 在 iframe 内放入旧版顶栏、文件行和 Fusion 附加区
   * 2) 模拟 frame 与内部节点可见尺寸
   */
  logger.info('开始构造旧版 115 同源 iframe')

  const dom = new JSDOM('<!doctype html><iframe id="main"></iframe>', {
    runScripts: 'outside-only',
    url: 'https://115.com/?mode=wangpan',
  })
  const { window } = dom

  try {
    const frame = window.document.querySelector('#main')
    const frameDocument = frame.contentDocument
    frameDocument.body.innerHTML = `
      <div class="list-cell"><ul><li title="BF-304.mp4"></li></ul></div>
      <a class="master-offline-task-btn">云下载</a>
      <a class="master-preview-switch-btn" aria-pressed="true" title="关闭文件预览"></a>
      <a>Master 播放</a>
      <section data-115master-detail data-115master-av-number="BF-304">BF-304 JavLibrary</section>
      <section data-115master-preview></section>
      <div id="shadow-host"></div>
    `
    const shadowButton = frameDocument.querySelector('#shadow-host')
      .attachShadow({ mode: 'open' })
      .appendChild(frameDocument.createElement('button'))
    shadowButton.setAttribute('data-shadow-action', '')

    /** 1.3 构造资料源常用元数据和图片属性，验证只读封面诊断。 */
    const coverMeta = frameDocument.createElement('meta')
    coverMeta.setAttribute('property', 'og:image')
    coverMeta.setAttribute('content', 'https://pics.example.com/cover-t.jpg')
    frameDocument.head.appendChild(coverMeta)
    const coverImage = frameDocument.createElement('img')
    coverImage.setAttribute('src', 'https://pics.example.com/cover-n.jpg')
    coverImage.setAttribute('srcset', 'https://pics.example.com/cover-n@2x.jpg 2x')
    frameDocument.body.appendChild(coverImage)

    /** 1.4 构造新版 115 的 SVG 搜索入口，验证非 HTMLElement 点击。 */
    const searchIcon = frameDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
    searchIcon.setAttribute('data-search-icon', '')
    searchIcon.scrollIntoView = () => {}
    let searchClickCount = 0
    searchIcon.addEventListener('click', () => {
      searchClickCount += 1
    })
    frameDocument.body.appendChild(searchIcon)

    /** 1.5 构造真实媒体属性和悬停监听，验证播放器专用只读命令。 */
    const media = frameDocument.createElement('video')
    media.id = 'media-target'
    let hoverCount = 0
    media.addEventListener('mousemove', () => {
      hoverCount += 1
    })
    media.scrollIntoView = () => {}
    Object.defineProperties(media, {
      paused: { value: false },
      ended: { value: false },
      muted: { value: true },
      volume: { value: 0.5 },
      playbackRate: { value: 1.25 },
      currentTime: { value: 12.3456 },
      duration: { value: 120.7894 },
      readyState: { value: 4 },
      networkState: { value: 1 },
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
      currentSrc: { value: 'https://cdn.example/video.mp4?token=secret' },
      buffered: {
        value: {
          length: 1,
          start: () => 0,
          end: () => 20.5678,
        },
      },
      error: { value: null },
    })
    frameDocument.body.appendChild(media)

    /** 1.6 构造 React 虚拟列表滚动容器，验证后台事件补发。 */
    const scrollTarget = frameDocument.createElement('div')
    scrollTarget.setAttribute('data-scroll-target', '')
    let scrollEventCount = 0
    scrollTarget.scrollTo = ({ top, left }) => {
      scrollTarget.scrollTop = top
      scrollTarget.scrollLeft = left
    }
    scrollTarget.addEventListener('scroll', () => {
      scrollEventCount += 1
    })
    frameDocument.body.appendChild(scrollTarget)

    /** 1.7 模拟 React 在元素实例上覆盖 value setter 的受控输入框。 */
    const reactInput = frameDocument.createElement('input')
    reactInput.setAttribute('data-react-input', '')
    let trackedSetterCount = 0
    let inputEventCount = 0
    let nativeInputValue = ''
    const nativeInputValueGetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.get
    Object.defineProperty(reactInput, 'value', {
      configurable: true,
      get: () => 'tracked-value',
      set: () => {
        trackedSetterCount += 1
      },
    })
    reactInput.addEventListener('input', () => {
      inputEventCount += 1
      nativeInputValue = nativeInputValueGetter?.call(reactInput) ?? ''
    })
    frameDocument.body.appendChild(reactInput)

    const visibleRect = {
      x: 10,
      y: 10,
      top: 10,
      right: 110,
      bottom: 50,
      left: 10,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    }
    frame.getBoundingClientRect = () => visibleRect
    frameDocument.querySelectorAll('*').forEach((element) => {
      element.getBoundingClientRect = () => visibleRect
    })
    shadowButton.getBoundingClientRect = () => visibleRect
    logger.info('旧版 115 同源 iframe 构造完成')

    /*
     * ================================================================================
     * 步骤2：加载测试桥并核对 iframe 状态
     * ================================================================================
     * 目标：证明查询、文字查找、状态汇总和可见链都穿透同源 iframe。
     * 数据源：测试桥只读 DOM 接口。
     * 操作：
     * 1) 注入最小 GM 环境并取得测试接口
     * 2) 核对旧版顶栏、详情、预览、文件行和 Shadow DOM
     */
    logger.info('开始核对旧版 iframe 页面状态')

    window.__115MASTER_BRIDGE_TEST__ = {}
    window.GM_registerMenuCommand = () => {}
    window.GM_getValue = () => undefined
    window.GM_setValue = () => {}
    window.GM_deleteValue = () => {}
    window.GM_xmlhttpRequest = () => {}
    const source = readFileSync(
      new URL('./115master-live-bridge.user.js', import.meta.url),
      'utf8',
    )
    window.eval(source)

    const api = window.__115MASTER_BRIDGE_TEST__
    const status = api.collectPageStatus(true)
    assert.equal(api.getAccessibleDocuments().length, 2)
    assert.equal(api.queryDeep('[data-115master-detail]').length, 1)
    assert.equal(
      api.queryDeep('#shadow-host >>> [data-shadow-action]').length,
      1,
    )
    assert.equal(api.findTextCandidates('Master 播放', true).length, 1)
    assert.equal(status.bridgeVersion, '0.2.14')
    assert.equal(status.pageFeatures.accessibleDocumentCount, 2)
    assert.equal(status.native.legacyRowCount, 1)
    assert.equal(status.native.visibleLegacyRowCount, 1)
    assert.equal(status.fusion.legacyControls.offlineButtonCount, 1)
    assert.equal(status.fusion.legacyControls.previewButtonCount, 1)
    assert.equal(status.fusion.legacyControls.previews[0].ariaPressed, 'true')
    assert.equal(status.fusion.detailCount, 1)
    assert.equal(status.fusion.visibleDetailCount, 1)
    assert.equal(status.fusion.previewCount, 1)
    assert.equal(status.fusion.visiblePreviewCount, 1)
    assert.equal(status.fusion.details[0].avNumber, 'BF-304')
    assert.equal(status.fusion.details[0].source, 'JavLibrary')
    assert.equal(status.pageFeatures.documents[1].frameVisible, true)

    /** 2.3 核对封面诊断保留 meta content 与图片 src/srcset。 */
    const metaDescription = api.queryElements({ selector: 'meta[property="og:image"]' })
    const imageDescription = api.queryElements({ selector: 'img[src]' })
    assert.equal(metaDescription.elements[0].attributes.content, 'https://pics.example.com/cover-t.jpg')
    assert.equal(imageDescription.elements[0].attributes.src, 'https://pics.example.com/cover-n.jpg')
    assert.equal(imageDescription.elements[0].attributes.srcset, 'https://pics.example.com/cover-n@2x.jpg 2x')

    /** 2.4 核对 SVG 图标点击，确保新版搜索入口可被自动化触发。 */
    api.clickElement({ selector: '[data-search-icon]' })
    assert.equal(searchClickCount, 1)

    /** 2.5 核对悬停事件和媒体摘要；输出中只能保留 CDN origin。 */
    api.hoverElement({ selector: '#media-target' })
    const mediaStatus = api.readMediaStatus({ selector: '#media-target' })
    assert.equal(hoverCount, 1)
    assert.equal(mediaStatus.count, 1)
    assert.equal(mediaStatus.elements[0].paused, false)
    assert.equal(mediaStatus.elements[0].currentTime, 12.346)
    assert.equal(mediaStatus.elements[0].duration, 120.789)
    assert.equal(mediaStatus.elements[0].sourceOrigin, 'https://cdn.example')
    assert.equal(mediaStatus.elements[0].buffered.length, 1)
    assert.equal(mediaStatus.elements[0].buffered[0].start, 0)
    assert.equal(mediaStatus.elements[0].buffered[0].end, 20.568)
    assert.doesNotMatch(JSON.stringify(mediaStatus), /token=secret/)

    /** 2.6 核对滚动实际坐标和虚拟列表同步事件。 */
    const scrollStatus = api.scrollPage({
      selector: '[data-scroll-target]',
      top: 1200,
      left: 4,
    })
    assert.equal(scrollStatus.top, 1200)
    assert.equal(scrollStatus.left, 4)
    assert.equal(scrollEventCount, 1)

    /** 2.7 核对原生 setter 绕过实例 tracker 并触发 input 事件。 */
    api.setInputValue({
      selector: '[data-react-input]',
      value: 'JAC-089',
    })
    assert.equal(trackedSetterCount, 0)
    assert.equal(inputEventCount, 1)
    assert.equal(nativeInputValue, 'JAC-089')

    /** 2.8 有效详情页包含 CF 脚本残留时不能误报挑战页。 */
    const validSourceResponse = api.summarizeHtmlResponse({
      requestUrl: 'https://www.javlibrary.com/cn/search',
      finalUrl: 'https://www.javlibrary.com/cn/detail',
      status: 200,
      statusText: 'OK',
      html: '<title>DANDY-423 - JAVLibrary</title><link rel="canonical" href="/cn/dandy-423"><meta property="og:image" content="//pics.example.com/cover.jpg"><script src="/challenge-platform.js"></script><div id="video_info"></div>',
    })
    assert.equal(validSourceResponse.cloudflareChallenge, false)
    assert.equal(validSourceResponse.hasJavLibraryVideo, true)
    assert.equal(validSourceResponse.canonicalUrl, 'https://www.javlibrary.com/cn/dandy-423')
    assert.equal(validSourceResponse.openGraphImage, 'https://pics.example.com/cover.jpg')

    /** 2.9 真实挑战页仍须保留门禁结果。 */
    const challengeResponse = api.summarizeHtmlResponse({
      requestUrl: 'https://www.javlibrary.com/cn/search',
      finalUrl: 'https://www.javlibrary.com/cn/search',
      status: 403,
      statusText: 'Forbidden',
      html: '<title>Just a moment...</title><div id="challenge-stage">Verify you are human</div>',
    })
    assert.equal(challengeResponse.cloudflareChallenge, true)

    frame.style.display = 'none'
    assert.equal(
      api.isVisible(frameDocument.querySelector('[data-115master-detail]')),
      false,
    )

    logger.info('旧版 iframe 页面状态核对完成')
  }
  finally {
    dom.window.close()
  }
})

test('publishes a Fusion copy with local update URLs', async () => {
  /*
   * ================================================================================
   * 步骤1：生成 Fusion 本地更新测试副本
   * ================================================================================
   * 目标：确认发布过程不改源文件，只改副本的两个更新地址。
   * 数据源：临时最小用户脚本。
   * 操作：
   * 1) 写入带正式地址的源脚本
   * 2) 发布并核对源文件和目标文件
   */
  logger.info('开始验证 Fusion 本地更新产物发布')

  const directory = await mkdtemp(join(tmpdir(), '115master-bridge-'))
  const source = join(directory, 'fusion.user.js')
  const destination = join(directory, 'published', 'fusion.user.js')
  const fixture = `// ==UserScript==\n// @name Fusion\n// @version 9.9.9\n// @downloadURL https://example.com/fusion.user.js\n// @updateURL https://example.com/fusion.meta.js\n// ==/UserScript==\nconsole.log('fixture')\n`
  writeFileSync(source, fixture)

  try {
    const result = publishFusionUpdate(source, { destinationFile: destination })
    const published = readFileSync(result.file, 'utf8')
    assert.equal(await readFile(source, 'utf8'), fixture)
    assert.match(published, /@downloadURL\s+http:\/\/127\.0\.0\.1:11531\/updates\/fusion\.user\.js/)
    assert.match(published, /@updateURL\s+http:\/\/127\.0\.0\.1:11531\/updates\/fusion\.meta\.js/)
    logger.info('Fusion 本地更新产物发布验证完成')
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
