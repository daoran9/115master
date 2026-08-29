// ==UserScript==
// @name         115Master Local Test Bridge
// @namespace    https://github.com/daoran9/115master/testing
// @version      0.2.16
// @description  Connects a normally started 115Browser tab to the local acceptance controller.
// @downloadURL  http://127.0.0.1:11531/updates/bridge.user.js
// @updateURL    http://127.0.0.1:11531/updates/bridge.meta.js
// @match        *://*/*
// @noframes
// @run-at       document-start
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      javbus.com
// @connect      javdb.com
// @connect      jdbstatic.com
// @connect      *.jdbstatic.com
// @connect      javlibrary.com
// @connect      missav.ws
// @connect      fourhoi.com
// @connect      fd2ppv.cc
// @connect      *.contents.fc2.com
// @connect      contents-thumbnail2.fc2.com
// @connect      xximgs.cc
// @connect      myfansdb.com
// @connect      *.myfansdb.com
// @connect      content.mfcdn.jp
// @connect      *.mfcdn.jp
// @connect      video.dmm.co.jp
// @connect      api.video.dmm.co.jp
// @connect      pics.dmm.co.jp
// @connect      awsimgsrc.dmm.co.jp
// ==/UserScript==

/* global GM_deleteValue, GM_getValue, GM_registerMenuCommand, GM_setValue, GM_xmlhttpRequest */
/* eslint-disable no-unmodified-loop-condition */

(function () {
  'use strict'

  const BRIDGE_VERSION = '0.2.16'
  const CONFIG_KEY = '115master-live-bridge-config'
  const CLIENT_ID_KEY = '115master-live-bridge-client-id'
  const FUSION_CACHE_DATABASE = '115master_cache'
  const FUSION_CACHE_META_STORE = 'meta'
  const FUSION_DETAIL_CACHE_STORES = ['jav_cache', 'image_cache']
  const MAX_RESULT_ITEMS = 100
  const POLL_DELAY_MS = 600
  const REQUEST_TIMEOUT_MS = 15_000
  const SOURCE_HOSTS = new Set([
    'javbus.com',
    'www.javbus.com',
    'javdb.com',
    'www.javdb.com',
    'javlibrary.com',
    'www.javlibrary.com',
    'missav.ws',
    'www.missav.ws',
    'fd2ppv.cc',
    'www.fd2ppv.cc',
    'myfansdb.com',
    'www.myfansdb.com',
    'adult.myfansdb.com',
    'gay.myfansdb.com',
    'video.dmm.co.jp',
    'api.video.dmm.co.jp',
  ])
  const IMAGE_HOSTS = new Set([
    'fourhoi.com',
    'www.fourhoi.com',
    'contents-thumbnail2.fc2.com',
    'xximgs.cc',
    'www.xximgs.cc',
    'content.mfcdn.jp',
    'pics.dmm.co.jp',
    'awsimgsrc.dmm.co.jp',
    'jdbstatic.com',
    'c0.jdbstatic.com',
  ])
  const IMAGE_HOST_SUFFIXES = [
    '.contents.fc2.com',
    '.mfcdn.jp',
    '.jdbstatic.com',
  ]
  const logger = {
    info: (...messages) => console.info('[115Master Test Bridge]', ...messages),
    warn: (...messages) => console.warn('[115Master Test Bridge]', ...messages),
  }

  let stopped = false

  if (globalThis.__115MASTER_BRIDGE_TEST__) {
    logger.info('开始暴露测试桥 DOM 验证接口')

    // 0.1 测试进程只取得只读 DOM 辅助函数，不进入生产控制链路。
    Object.assign(globalThis.__115MASTER_BRIDGE_TEST__, {
      collectPageStatus,
      clickElement,
      findTextCandidates,
      getAccessibleDocuments,
      hoverElement,
      isVisible,
      queryDeep,
      queryElements,
      readMediaStatus,
      scrollPage,
      setInputValue,
      summarizeHtmlResponse,
      validateImageUrl,
      validateSourceUrl,
    })

    logger.info('测试桥 DOM 验证接口暴露完成')
  }

  /**
   * ================================================================================
   * 步骤1：注册显式启停入口
   * ================================================================================
   * 目标：测试桥默认关闭，只接受用户从本机控制端取得的连接码。
   * 数据源：Tampermonkey 菜单和脚本私有存储。
   * 操作：
   * 1) 校验回环地址、端口和令牌
   * 2) 保存或删除当前测试会话
   */
  logger.info('开始注册本机测试桥菜单')

  GM_registerMenuCommand('115Master：连接本机测试桥', () => {
    /** 1.1 连接码由本地控制端生成，拒绝非回环地址。 */
    const input = window.prompt('粘贴本机控制端输出的连接码')
    if (!input)
      return

    const config = parseConnectionCode(input)
    if (!config) {
      window.alert('连接码无效，只允许 http://127.0.0.1:<端口>/?token=<令牌>')
      return
    }

    // 1.2 保存后刷新当前页面，让测试桥从 document-start 开始工作。
    GM_setValue(CONFIG_KEY, config)
    window.location.reload()
  })

  GM_registerMenuCommand('115Master：断开本机测试桥', () => {
    // 1.3 删除测试会话并停止后续轮询。
    stopped = true
    GM_deleteValue(CONFIG_KEY)
    window.alert('本机测试桥已断开')
  })

  logger.info('本机测试桥菜单注册完成')

  const config = readBridgeConfig()
  if (!config) {
    logger.info('本机测试桥保持关闭')
    return
  }

  const clientId = getClientId()
  logger.info('开始连接本机测试控制端', config.origin, clientId)
  void pollLoop(config, clientId)

  /** 校验并解析本机控制端连接码。 */
  function parseConnectionCode(input) {
    try {
      const url = new URL(input.trim())
      const token = url.searchParams.get('token')?.trim()
      const port = Number(url.port)
      if (
        url.protocol !== 'http:'
        || url.hostname !== '127.0.0.1'
        || !Number.isInteger(port)
        || port < 1024
        || port > 65535
        || !token
        || !/^[a-f0-9]{32,128}$/i.test(token)
      ) {
        return null
      }
      return {
        origin: `http://127.0.0.1:${port}`,
        token,
      }
    }
    catch {
      return null
    }
  }

  /** 从 Tampermonkey 私有存储读取并复核配置。 */
  function readBridgeConfig() {
    const stored = GM_getValue(CONFIG_KEY)
    if (!stored || typeof stored !== 'object')
      return null
    return parseConnectionCode(`${stored.origin}/?token=${stored.token}`)
  }

  /** 为每个标签页生成独立客户端标识。 */
  function getClientId() {
    const existing = window.sessionStorage.getItem(CLIENT_ID_KEY)
    if (existing)
      return existing
    const id
      = globalThis.crypto?.randomUUID?.()
        ?? `client-${Date.now()}-${Math.random().toString(16).slice(2)}`
    window.sessionStorage.setItem(CLIENT_ID_KEY, id)
    return id
  }

  /**
   * ================================================================================
   * 步骤2：轮询本地命令并回传结果
   * ================================================================================
   * 目标：让正常启动的浏览器保持原会话，同时接受受限的现场验收命令。
   * 数据源：127.0.0.1 控制端和当前 115 页面。
   * 操作：
   * 1) 上报标签页摘要并领取一条命令
   * 2) 执行白名单命令并回传结构化结果
   */
  async function pollLoop(activeConfig, activeClientId) {
    logger.info('开始轮询本机测试命令')

    while (!stopped) {
      try {
        /** 2.1 每轮都附带当前页面摘要，控制端可区分新旧页面标签。 */
        const response = await requestJson(activeConfig, '/v1/poll', {
          clientId: activeClientId,
          page: collectPageStatus(false),
        })

        if (response?.command) {
          const result = await executeCommand(response.command)
          // 2.2 先确认结果已送达，再处理刷新或导航。
          await requestJson(activeConfig, '/v1/result', {
            clientId: activeClientId,
            commandId: response.command.id,
            ok: result.ok,
            value: result.value,
            error: result.error,
          })
          applyDeferredAction(result.deferredAction)
        }
      }
      catch (error) {
        logger.warn('本机测试桥轮询失败，将继续重试', serializeError(error))
      }

      await delay(POLL_DELAY_MS)
    }

    logger.info('本机测试命令轮询完成')
  }

  /** 用 GM_xmlhttpRequest 绕过 HTTPS 页面到回环 HTTP 的混合内容限制。 */
  function requestJson(activeConfig, pathname, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${activeConfig.origin}${pathname}`,
        headers: {
          'Content-Type': 'application/json',
          'X-115Master-Bridge-Token': activeConfig.token,
        },
        data: JSON.stringify(data),
        timeout: REQUEST_TIMEOUT_MS,
        onload: (response) => {
          if (response.status === 204 || !response.responseText) {
            resolve(null)
            return
          }
          if (response.status < 200 || response.status >= 300) {
            reject(
              new Error(
                `HTTP ${response.status}: ${response.responseText.slice(0, 300)}`,
              ),
            )
            return
          }
          try {
            resolve(JSON.parse(response.responseText))
          }
          catch (error) {
            reject(error)
          }
        },
        onerror: () => reject(new Error('本机控制端不可达')),
        ontimeout: () => reject(new Error('本机控制端响应超时')),
      })
    })
  }

  /** 执行控制端允许的命令。 */
  async function executeCommand(command) {
    logger.info('开始执行本机测试命令', command.id, command.type)

    try {
      let value
      let deferredAction
      switch (command.type) {
        case 'status':
          value = collectPageStatus(true)
          break
        case 'query':
          value = queryElements(command.payload)
          break
        case 'click':
          value = clickElement(command.payload)
          break
        case 'clickText':
          value = clickElementByText(command.payload)
          break
        case 'input':
          value = setInputValue(command.payload)
          break
        case 'scroll':
          value = scrollPage(command.payload)
          break
        case 'hover':
          value = hoverElement(command.payload)
          break
        case 'mediaStatus':
          value = readMediaStatus(command.payload)
          break
        case 'probeJavLibrary':
          value = await probeJavLibrary(command.payload)
          break
        case 'requestSource':
          value = await requestSource(command.payload)
          break
        case 'probeImage':
          value = await probeImage(command.payload)
          break
        case 'fetchSameOrigin':
          value = await fetchSameOrigin(command.payload)
          break
        case 'clearFusionDetailCache':
          value = await clearFusionDetailCache()
          break
        case 'reload':
          value = { scheduled: true, url: window.location.href }
          deferredAction = { type: 'reload' }
          break
        case 'navigate':
          value = {
            scheduled: true,
            url: validate115Url(command.payload?.url).href,
          }
          deferredAction = { type: 'navigate', url: value.url }
          break
        case 'back':
          value = { scheduled: true, url: window.location.href }
          deferredAction = { type: 'back' }
          break
        default:
          throw new Error(`不支持的命令: ${String(command.type)}`)
      }

      logger.info('本机测试命令执行完成', command.id, command.type)
      return { ok: true, value, deferredAction }
    }
    catch (error) {
      logger.warn('本机测试命令执行失败', command.id, command.type, error)
      return { ok: false, error: serializeError(error) }
    }
  }

  /** 延迟到结果回传后再改变页面。 */
  function applyDeferredAction(action) {
    if (!action)
      return
    window.setTimeout(() => {
      if (action.type === 'reload')
        window.location.reload()
      else if (action.type === 'navigate')
        window.location.assign(action.url)
      else if (action.type === 'back')
        window.history.back()
    }, 50)
  }

  /**
   * ================================================================================
   * 步骤3：采集 115Master 页面状态
   * ================================================================================
   * 目标：用稳定属性判断脚本版本、列表增强、详情、预览和工具栏状态。
   * 数据源：生产脚本创建的 data-115master-* 节点与开放 Shadow DOM。
   * 操作：
   * 1) 统计原生行和 Fusion 附加区
   * 2) 提取详情来源及工具栏按钮状态
   */
  function collectPageStatus(includeDetails) {
    logger.info('开始采集 115Master 页面状态')

    const accessibleDocuments = getAccessibleDocuments()
    const controls = queryDeep(
      '[data-115master-controls]',
      accessibleDocuments,
    ).map((host) => {
      const root = host.shadowRoot
      const preview = root?.querySelector('[data-115master-preview-toggle]')
      const launcher = root?.querySelector('[data-115master-launcher-link]')
      return {
        version: host.getAttribute('data-115master-version'),
        placement: host.getAttribute('data-placement'),
        preview: preview
          ? {
              ariaLabel: preview.getAttribute('aria-label'),
              ariaPressed: preview.getAttribute('aria-pressed'),
              title: preview.getAttribute('title'),
              visible: isVisible(preview),
            }
          : null,
        launcher: launcher
          ? {
              href: launcher.getAttribute('href'),
              text: normalizeText(launcher.textContent),
              visible: isVisible(launcher),
            }
          : null,
      }
    })

    const legacyPreviewButtons = queryDeep(
      '.master-preview-switch-btn',
      accessibleDocuments,
    )
    const legacyOfflineButtons = queryDeep(
      '.master-offline-task-btn',
      accessibleDocuments,
    )
    const detailNodes = queryDeep(
      '[data-115master-detail]',
      accessibleDocuments,
    )
    const previewNodes = queryDeep(
      '[data-115master-preview]',
      accessibleDocuments,
    )
    const enhancedRows = queryDeep(
      '[data-115master-enhanced]',
      accessibleDocuments,
    )
    const status = {
      bridgeVersion: BRIDGE_VERSION,
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      cloudflareChallenge: isCloudflareChallengeDocument(document),
      pageFeatures: {
        bodyTextSample: normalizeText(document.body?.textContent).slice(0, 300),
        linkCount: document.links.length,
        formCount: document.forms.length,
        accessibleDocumentCount: accessibleDocuments.length,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      fusion: {
        adapterVersion: accessibleDocuments
          .map(candidate => candidate.documentElement?.getAttribute(
            'data-115master-official-file-list',
          ))
          .find(Boolean) ?? null,
        controlCount: controls.length,
        controls,
        legacyControls: {
          offlineButtonCount: legacyOfflineButtons.length,
          visibleOfflineButtonCount: legacyOfflineButtons.filter(isVisible).length,
          previewButtonCount: legacyPreviewButtons.length,
          visiblePreviewButtonCount: legacyPreviewButtons.filter(isVisible).length,
          previews: legacyPreviewButtons
            .slice(0, MAX_RESULT_ITEMS)
            .map(button => ({
              ariaLabel: button.getAttribute('aria-label'),
              ariaPressed: button.getAttribute('aria-pressed'),
              title: button.getAttribute('title'),
              visible: isVisible(button),
            })),
        },
        enhancedRowCount: enhancedRows.length,
        detailCount: detailNodes.length,
        visibleDetailCount: detailNodes.filter(isVisible).length,
        previewCount: previewNodes.length,
        visiblePreviewCount: previewNodes.filter(isVisible).length,
        nativeActionCount: queryDeep(
          '[data-115master-native-actions]',
          accessibleDocuments,
        ).length,
        gridPanelCount: queryDeep(
          '[data-115master-grid-panel]',
          accessibleDocuments,
        ).length,
      },
      native: {
        listRowCount: queryDeep(
          '.file-list-item[data-file-id], .file-list-item[data-id]',
          accessibleDocuments,
        ).length,
        gridRowCount: queryDeep(
          '.file-grid-item[data-file-id], .file-grid-item[data-id]',
          accessibleDocuments,
        ).length,
        legacyRowCount: queryDeep('.list-cell li', accessibleDocuments).length,
        visibleLegacyRowCount: queryDeep(
          '.list-cell li',
          accessibleDocuments,
        ).filter(isVisible).length,
        newButtonCount: findTextCandidates(
          '新建',
          true,
          accessibleDocuments,
        ).length,
      },
    }

    if (includeDetails) {
      status.fusion.details = detailNodes
        .slice(0, MAX_RESULT_ITEMS)
        .map((node) => {
          const text = getNodeText(node)
          const links = getDeepElements(node, 'a[href]')
            .map(link => link.getAttribute('href'))
            .filter(Boolean)
          return {
            avNumber: node.getAttribute('data-115master-av-number'),
            connected: node.isConnected,
            visible: isVisible(node),
            source: inferSource(text, links),
            text: text.slice(0, 500),
            links: links.slice(0, 10),
          }
        })
      status.pageFeatures.documents = accessibleDocuments
        .slice(0, MAX_RESULT_ITEMS)
        .map(candidate => ({
          url: candidate.location?.href ?? null,
          title: candidate.title,
          frameVisible: candidate === document
            ? true
            : isVisible(candidate.defaultView?.frameElement),
        }))
    }

    logger.info('115Master 页面状态采集完成')
    return status
  }

  /** 查询普通 DOM 或用 >>> 穿过开放 Shadow DOM。 */
  function queryElements(payload) {
    const selector = String(payload?.selector ?? '').trim()
    if (!selector)
      throw new Error('query.selector 不能为空')
    const elements = queryDeep(selector).slice(0, MAX_RESULT_ITEMS)
    return {
      selector,
      count: queryDeep(selector).length,
      elements: elements.map(describeElement),
    }
  }

  /**
   * ================================================================================
   * 步骤4：触发只读悬停并读取媒体状态
   * ================================================================================
   * 目标：让隐藏式播放器控制栏可被现场验收，并取得真实解码与播放状态。
   * 数据源：白名单 CSS 选择器命中的页面节点和 HTMLMediaElement 公共属性。
   * 操作：
   * 1) 只发送鼠标悬停事件，不点击或修改业务数据
   * 2) 只返回媒体时长、进度、解码尺寸和播放状态，不返回带鉴权参数的地址
   */

  /** 向指定节点发送悬停事件，让依赖 mousemove 的控制栏进入可见态。 */
  function hoverElement(payload) {
    logger.info('开始触发页面节点悬停')

    /** 4.1 选择节点并使用其所属窗口创建事件，兼容旧版同源 iframe。 */
    const selector = String(payload?.selector ?? '').trim()
    const index = Number(payload?.index ?? 0)
    const element = queryDeep(selector)[index]
    if (!isHtmlElement(element))
      throw new Error(`未找到可悬停节点: ${selector}[${index}]`)

    element.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = element.getBoundingClientRect()
    const elementWindow = element.ownerDocument.defaultView ?? window
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
      view: elementWindow,
    }
    for (const eventName of ['mouseover', 'mouseenter', 'mousemove']) {
      element.dispatchEvent(new elementWindow.MouseEvent(eventName, eventOptions))
    }

    const result = describeElement(element)
    logger.info('页面节点悬停触发完成', selector, index)
    return result
  }

  /** 读取当前页面媒体元素的真实运行状态。 */
  function readMediaStatus(payload) {
    logger.info('开始读取页面媒体状态')

    /** 4.2 默认只读 video；调用方可收窄选择器，但不能执行任意脚本。 */
    const selector = String(payload?.selector ?? 'video').trim() || 'video'
    const mediaElements = queryDeep(selector)
      .filter(element => ['audio', 'video'].includes(element.tagName?.toLowerCase()))
      .slice(0, MAX_RESULT_ITEMS)
    const elements = mediaElements.map((element) => {
      const ranges = []
      for (let index = 0; index < element.buffered.length; index += 1) {
        ranges.push({
          start: roundMediaNumber(element.buffered.start(index)),
          end: roundMediaNumber(element.buffered.end(index)),
        })
      }
      return {
        tag: element.tagName.toLowerCase(),
        visible: isVisible(element),
        paused: Boolean(element.paused),
        ended: Boolean(element.ended),
        muted: Boolean(element.muted),
        volume: roundMediaNumber(element.volume),
        playbackRate: roundMediaNumber(element.playbackRate),
        currentTime: roundMediaNumber(element.currentTime),
        duration: roundMediaNumber(element.duration),
        readyState: Number(element.readyState),
        networkState: Number(element.networkState),
        videoWidth: Number(element.videoWidth ?? 0),
        videoHeight: Number(element.videoHeight ?? 0),
        sourceOrigin: getMediaSourceOrigin(element.currentSrc || element.src),
        buffered: ranges,
        error: element.error
          ? { code: Number(element.error.code), message: String(element.error.message || '') }
          : null,
      }
    })

    logger.info('页面媒体状态读取完成', elements.length)
    return { selector, count: mediaElements.length, elements }
  }

  /** 保留媒体数值三位小数，避免现场日志产生无意义浮点噪声。 */
  function roundMediaNumber(value) {
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null
  }

  /** 只保留媒体源 origin，禁止把 CDN 鉴权查询参数写入控制端日志。 */
  function getMediaSourceOrigin(value) {
    try {
      return value ? new URL(value, window.location.href).origin : null
    }
    catch {
      return null
    }
  }

  /** 点击指定选择器的第 N 个节点。 */
  function clickElement(payload) {
    logger.info('开始点击页面节点')

    /** 4.3 接受 HTML 与 SVG 节点，兼容新版 115 的图标式搜索入口。 */
    const selector = String(payload?.selector ?? '').trim()
    const index = Number(payload?.index ?? 0)
    const element = queryDeep(selector)[index]
    if (!isElementNode(element))
      throw new Error(`未找到可点击节点: ${selector}[${index}]`)
    element.scrollIntoView({ block: 'center', inline: 'center' })
    const elementWindow = element.ownerDocument.defaultView ?? window

    /** 4.4 HTMLElement 使用原生 click；SVGElement 派发等价的冒泡鼠标事件。 */
    if (typeof element.click === 'function') {
      element.click()
    }
    else {
      element.dispatchEvent(new elementWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: elementWindow,
      }))
    }

    const result = describeElement(element)
    logger.info('页面节点点击完成', selector, index)
    return result
  }

  /** 按可见文字点击按钮、链接或 role=button 节点。 */
  function clickElementByText(payload) {
    const text = normalizeText(String(payload?.text ?? ''))
    const exact = payload?.exact !== false
    const candidates = findTextCandidates(text, exact).filter(isVisible)
    const index = Number(payload?.index ?? 0)
    const element = candidates[index]
    if (!element)
      throw new Error(`未找到可见操作项: ${text}[${index}]`)
    element.scrollIntoView({ block: 'center', inline: 'center' })
    element.click()
    return describeElement(element)
  }

  /**
   * ================================================================================
   * 步骤3：设置框架受控输入框
   * ================================================================================
   * 目标：让 React 等框架收到真实值变化，避免只更新 DOM 跟踪值。
   * 数据源：控制端传入的输入框选择器和文本。
   * 操作：
   * 1) 调用输入框所属 realm 的原生 value setter
   * 2) 派发 input 和 change 事件
   */
  function setInputValue(payload) {
    logger.info('开始设置页面输入框')

    // eslint-disable-next-line jsdoc/convert-to-jsdoc-comments -- 项目步骤注释使用编号行注释。
    // 3.1 定位可访问页面中的目标输入框。
    const selector = String(payload?.selector ?? '').trim()
    const value = String(payload?.value ?? '')
    const index = Number(payload?.index ?? 0)
    const element = queryDeep(selector)[index]
    if (!isTextInput(element)) {
      throw new TypeError(`未找到输入框: ${selector}[${index}]`)
    }
    const elementWindow = element.ownerDocument.defaultView ?? window
    element.focus()

    // eslint-disable-next-line jsdoc/convert-to-jsdoc-comments -- 项目步骤注释使用编号行注释。
    // 3.2 绕过 React 在元素实例上安装的 value tracker。
    const prototype = element instanceof elementWindow.HTMLTextAreaElement
      ? elementWindow.HTMLTextAreaElement.prototype
      : elementWindow.HTMLInputElement.prototype
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      prototype,
      'value',
    )?.set
    if (nativeValueSetter)
      nativeValueSetter.call(element, value)
    else
      element.value = value

    // 3.3 通知页面框架提交新状态。
    element.dispatchEvent(
      new elementWindow.InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: value,
      }),
    )
    element.dispatchEvent(new elementWindow.Event('change', { bubbles: true }))
    const result = describeElement(element)
    logger.info('页面输入框设置完成', selector, index)
    return result
  }

  /** 滚动页面或指定滚动容器。 */
  /**
   * ================================================================================
   * 步骤4：滚动页面或列表容器
   * ================================================================================
   * 目标：让 React 虚拟列表在后台标签中也能同步可见行。
   * 数据源：控制端传入的滚动目标、横纵坐标。
   * 操作：
   * 1) 更新真实滚动位置
   * 2) 显式补发同 realm scroll 事件并回传实际坐标
   */
  function scrollPage(payload) {
    logger.info('开始滚动页面测试目标')

    // eslint-disable-next-line jsdoc/convert-to-jsdoc-comments -- 项目步骤注释使用编号行注释。
    // 4.1 定位顶层窗口或可访问 iframe 内的列表容器。
    const selector = String(payload?.selector ?? '').trim()
    const target = selector
      ? queryDeep(selector)[Number(payload?.index ?? 0)]
      : window
    if (!target)
      throw new Error(`未找到滚动目标: ${selector}`)
    const top = Number(payload?.top ?? payload?.y ?? 0)
    const left = Number(payload?.left ?? payload?.x ?? 0)
    target.scrollTo({ top, left, behavior: 'instant' })

    // 4.2 后台标签可能延迟原生事件，为 React 虚拟列表同步补发一次。
    if (target !== window) {
      const targetWindow = target.ownerDocument?.defaultView
      if (targetWindow)
        target.dispatchEvent(new targetWindow.Event('scroll'))
    }

    const actualTop = target === window ? window.scrollY : target.scrollTop
    const actualLeft = target === window ? window.scrollX : target.scrollLeft
    logger.info('页面测试目标滚动完成', actualTop, actualLeft)
    return {
      selector: selector || 'window',
      top: actualTop,
      left: actualLeft,
    }
  }

  /** 把 IndexedDB 请求转换为 Promise。 */
  function waitForDatabaseRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'))
    })
  }

  /** 等待 IndexedDB 事务完整提交。 */
  function waitForDatabaseTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务中止'))
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'))
    })
  }

  /** 打开已经存在的 Fusion 缓存数据库，不创建新库。 */
  async function openFusionCacheDatabase() {
    const databases = typeof indexedDB.databases === 'function'
      ? await indexedDB.databases()
      : []
    if (!databases.some(database => database.name === FUSION_CACHE_DATABASE))
      return null
    return waitForDatabaseRequest(indexedDB.open(FUSION_CACHE_DATABASE))
  }

  /** 删除 jav_cache 与 image_cache 对应的配额元数据。 */
  function clearFusionCacheMetadata(store) {
    return new Promise((resolve, reject) => {
      let deleted = 0
      const request = store.openCursor()
      request.onerror = () => reject(request.error || new Error('缓存元数据读取失败'))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(deleted)
          return
        }
        if (FUSION_DETAIL_CACHE_STORES.includes(cursor.value?.storeName)) {
          cursor.delete()
          deleted += 1
        }
        cursor.continue()
      }
    })
  }

  /**
   * ================================================================================
   * 步骤4：清除 Fusion 番号详情缓存
   * ================================================================================
   * 目标：让真实页面重新请求 JavLibrary，并重新加载 DMM 封面。
   * 数据源：115.com 当前 origin 下的 115master_cache IndexedDB。
   * 操作：
   * 1) 只清 jav_cache 与 image_cache 两个固定对象仓库
   * 2) 同步清理对应配额元数据并返回清理前后数量
   */
  async function clearFusionDetailCache() {
    logger.info('开始清除 Fusion 番号详情缓存')

    /** 4.1 只允许在 115 主站清缓存，外部资料源标签保持原样。 */
    if (window.location.hostname !== '115.com')
      throw new Error('Fusion 番号详情缓存只能在 115.com 页面清除')

    const database = await openFusionCacheDatabase()
    if (!database) {
      logger.info('Fusion 番号详情缓存清除完成，数据库不存在')
      return { database: FUSION_CACHE_DATABASE, stores: {}, metadataDeleted: 0 }
    }

    try {
      /** 4.2 固定白名单之外的字幕、视频封面和用户设置不能进入事务。 */
      const stores = FUSION_DETAIL_CACHE_STORES.filter(storeName =>
        database.objectStoreNames.contains(storeName),
      )
      const hasMeta = database.objectStoreNames.contains(FUSION_CACHE_META_STORE)
      const transactionStores = [
        ...stores,
        ...(hasMeta ? [FUSION_CACHE_META_STORE] : []),
      ]
      if (transactionStores.length === 0) {
        logger.info('Fusion 番号详情缓存清除完成，没有可清对象仓库')
        return { database: FUSION_CACHE_DATABASE, stores: {}, metadataDeleted: 0 }
      }

      const transaction = database.transaction(transactionStores, 'readwrite')
      const transactionDone = waitForDatabaseTransaction(transaction)
      const counts = await Promise.all(stores.map((storeName) => {
        const store = transaction.objectStore(storeName)
        const count = waitForDatabaseRequest(store.count())
        store.clear()
        return count
      }))
      const metadataDeleted = hasMeta
        ? await clearFusionCacheMetadata(transaction.objectStore(FUSION_CACHE_META_STORE))
        : 0
      await transactionDone

      const clearedStores = Object.fromEntries(
        stores.map((storeName, index) => [storeName, Number(counts[index] || 0)]),
      )
      logger.info('Fusion 番号详情缓存清除完成', clearedStores, metadataDeleted)
      return {
        database: FUSION_CACHE_DATABASE,
        stores: clearedStores,
        metadataDeleted,
      }
    }
    finally {
      database.close()
    }
  }

  /**
   * ================================================================================
   * 步骤4：在正常浏览器会话探测外部资料源
   * ================================================================================
   * 目标：区分浏览器可访问、GM 跨域访问和 Cloudflare 挑战三种状态。
   * 数据源：Tampermonkey GM_xmlhttpRequest 与当前浏览器 Cookie 分区。
   * 操作：
   * 1) 用与生产 JavLibrary 相同的 cookiePartition 请求搜索页
   * 2) 仅回传状态、页面特征和短摘要，不保存完整页面
   */
  async function probeJavLibrary(payload) {
    logger.info('开始探测正常浏览器 JavLibrary 请求')

    const avNumber = String(payload?.avNumber ?? '').trim()
    if (!/^[a-z0-9][\w.-]{1,79}$/i.test(avNumber))
      throw new Error('probeJavLibrary.avNumber 格式无效')
    const url = `https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=${encodeURIComponent(avNumber)}`
    const result = await gmSourceRequest({
      url,
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://www.javlibrary.com/cn/',
      },
      cookie: 'over18=18',
      cookiePartition: {
        topLevelSite: 'https://javlibrary.com',
      },
    })

    logger.info(
      '正常浏览器 JavLibrary 请求探测完成',
      result.status,
      result.cloudflareChallenge,
    )
    return result
  }

  /** 向允许的资料源发送只读 GET 请求。 */
  async function requestSource(payload) {
    const url = validateSourceUrl(payload?.url)
    return gmSourceRequest({
      url: url.href,
      headers: sanitizeHeaders(payload?.headers),
      cookie:
        typeof payload?.cookie === 'string'
          ? payload.cookie.slice(0, 500)
          : undefined,
      cookiePartition: validateCookiePartition(payload?.cookiePartition),
    })
  }

  /** 用 Tampermonkey Blob 请求和 Canvas 路径只读探测资料源封面。 */
  async function probeImage(payload) {
    /*
     * ================================================================================
     * 步骤1：请求并解码资料源封面
     * ================================================================================
     * 目标：区分图片域名权限、HTTP 响应、Blob 解码和 WebP 压缩故障。
     * 数据源：白名单图片 URL、可选资料源 Referer、GM_xmlhttpRequest。
     * 操作：
     * 1) 用生产图片加载器相同的 Blob 响应类型请求图片
     * 2) 用 Image 和 Canvas 验证解码及 WebP 输出
     */
    logger.info('开始探测资料源封面')

    /** 1.1 图片地址和 Referer 分别限制在图片与资料源白名单。 */
    const url = validateImageUrl(payload?.url)
    const referer = payload?.referer
      ? validateSourceUrl(payload.referer).href
      : undefined
    const response = await requestImageBlob(url.href, referer)

    /** 1.2 复用浏览器原生图片解码和 Canvas WebP 编码路径。 */
    const decoded = response.blob.size
      ? await inspectImageBlob(response.blob)
      : { decoded: false, width: 0, height: 0, webpBytes: 0, error: '图片响应为空' }
    const result = {
      requestUrl: url.href,
      finalUrl: response.finalUrl,
      status: response.status,
      contentType: response.blob.type,
      bytes: response.blob.size,
      ...decoded,
    }
    logger.info('资料源封面探测完成', result.status, result.decoded, result.webpBytes)
    return result
  }

  /** 发送受限的 GM 图片 Blob 请求。 */
  function requestImageBlob(url, referer) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: referer ? { Referer: referer } : undefined,
        responseType: 'blob',
        timeout: REQUEST_TIMEOUT_MS,
        onload: (response) => {
          const blob = response.response instanceof Blob
            ? response.response
            : new Blob(response.response ? [response.response] : [])
          resolve({
            status: response.status,
            finalUrl: response.finalUrl || url,
            blob,
          })
        },
        onerror: () => reject(new Error('图片网络请求失败')),
        ontimeout: () => reject(new Error('图片网络请求超时')),
      })
    })
  }

  /** 用与 Fusion 相同的浏览器能力验证 Blob 解码和 WebP 输出。 */
  function inspectImageBlob(blob) {
    return new Promise((resolve) => {
      const image = new Image()
      const objectUrl = URL.createObjectURL(blob)
      const finish = (value) => {
        URL.revokeObjectURL(objectUrl)
        resolve(value)
      }

      image.onload = () => {
        const scale = Math.min(1, 720 / image.width, 720 / image.height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) {
          finish({ decoded: true, width: image.width, height: image.height, webpBytes: 0, error: '无法获取 Canvas 上下文' })
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((output) => {
          finish({
            decoded: true,
            width: image.width,
            height: image.height,
            webpBytes: output?.size ?? 0,
            error: output ? null : 'WebP 压缩失败',
          })
        }, 'image/webp', 0.8)
      }
      image.onerror = () => finish({ decoded: false, width: 0, height: 0, webpBytes: 0, error: 'Blob 图片解码失败' })
      image.src = objectUrl
    })
  }

  /**
   * ================================================================================
   * 步骤5：在资料源顶层页面发送第一方同源请求
   * ================================================================================
   * 目标：验证后台工作页能否复用真实页面会话批量读取详情。
   * 数据源：当前顶层页面的 fetch、Cookie 和 Cloudflare 会话。
   * 操作：
   * 1) 只允许当前 origin 的 GET 请求
   * 2) 返回状态和页面特征，不回传完整 HTML
   */
  async function fetchSameOrigin(payload) {
    logger.info('开始发送第一方同源测试请求')

    const url = new URL(String(payload?.url ?? ''), window.location.href)
    if (url.origin !== window.location.origin)
      throw new Error('fetchSameOrigin 只允许当前页面 origin')

    const response = await window.fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    })
    const html = await response.text()
    const result = summarizeHtmlResponse({
      requestUrl: url.href,
      finalUrl: response.url || url.href,
      status: response.status,
      statusText: response.statusText,
      html,
    })

    logger.info('第一方同源测试请求完成', result.status, result.cloudflareChallenge)
    return result
  }

  /** 包装受限的 GM 资料源请求并提取诊断特征。 */
  function gmSourceRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: options.url,
        headers: options.headers,
        cookie: options.cookie,
        cookiePartition: options.cookiePartition,
        timeout: REQUEST_TIMEOUT_MS,
        onload: (response) => {
          const html = response.responseText ?? ''
          resolve(summarizeHtmlResponse({
            requestUrl: options.url,
            finalUrl: response.finalUrl || options.url,
            status: response.status,
            statusText: response.statusText,
            html,
          }))
        },
        onerror: () => reject(new Error('资料源网络请求失败')),
        ontimeout: () => reject(new Error('资料源网络请求超时')),
      })
    })
  }

  /** 把 HTML 响应压缩成不含 Cookie 和完整正文的诊断摘要。 */
  function summarizeHtmlResponse(response) {
    const dom = new DOMParser().parseFromString(response.html, 'text/html')
    const hasJavLibraryVideo = Boolean(
      dom.querySelector('#video_info, #video_title, .video'),
    )
    const openGraphImage = dom
      .querySelector('meta[property="og:image"]')
      ?.getAttribute('content')
    const canonicalUrl = dom
      .querySelector('link[rel="canonical"]')
      ?.getAttribute('href')
    return {
      requestUrl: response.requestUrl,
      finalUrl: response.finalUrl,
      status: response.status,
      statusText: response.statusText,
      bytes: response.html.length,
      title: normalizeText(dom.title),
      canonicalUrl: resolveResponseUrl(canonicalUrl, response.finalUrl),
      openGraphImage: resolveResponseUrl(openGraphImage, response.finalUrl),
      cloudflareChallenge: isCloudflareChallengeDocument(dom),
      hasJavLibraryVideo,
      textSample: normalizeText(dom.body?.textContent).slice(0, 500),
    }
  }

  /** 把资料源元数据中的相对地址解析为绝对地址。 */
  function resolveResponseUrl(value, baseUrl) {
    if (!value)
      return null
    try {
      return new URL(value, baseUrl).href
    }
    catch {
      return null
    }
  }

  /** 用标题和挑战节点判断当前页面，避免普通页面脚本造成误报。 */
  function isCloudflareChallengeDocument(dom) {
    const title = normalizeText(dom.title)
    const bodyText = normalizeText(dom.body?.textContent).slice(0, 300)
    return /just a moment|请稍候|稍候/i.test(title)
      || Boolean(dom.querySelector('#challenge-running, #challenge-stage, #challenge-error-text'))
      || /正在进行安全验证|enable javascript and cookies to continue/i.test(bodyText)
  }

  /** 只允许 115 页面导航。 */
  function validate115Url(value) {
    const url = new URL(String(value ?? ''), window.location.href)
    if (
      url.protocol !== 'https:'
      || !(url.hostname === '115.com' || url.hostname === 'dl.115cdn.net')
    ) {
      throw new Error('测试桥只允许导航到 115 页面')
    }
    return url
  }

  /** 只允许已登记的资料源 URL。 */
  function validateSourceUrl(value) {
    const url = new URL(String(value ?? ''))
    if (url.protocol !== 'https:' || !SOURCE_HOSTS.has(url.hostname))
      throw new Error('资料源 URL 不在测试白名单')
    return url
  }

  /** 只允许已登记的资料源图片域名。 */
  function validateImageUrl(value) {
    const url = new URL(String(value ?? ''))
    const allowedHost = IMAGE_HOSTS.has(url.hostname)
      || IMAGE_HOST_SUFFIXES.some(suffix => url.hostname.endsWith(suffix))
    if (url.protocol !== 'https:' || !allowedHost)
      throw new Error('图片 URL 不在测试白名单')
    return url
  }

  /** 过滤可由测试命令设置的请求头。 */
  function sanitizeHeaders(value) {
    if (!value || typeof value !== 'object')
      return undefined
    const allowed = new Set([
      'accept',
      'accept-language',
      'referer',
      'user-agent',
    ])
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => allowed.has(key.toLowerCase()))
        .map(([key, headerValue]) => [key, String(headerValue).slice(0, 500)]),
    )
  }

  /** 复核 Cookie 分区只能指向当前资料源顶级站点。 */
  function validateCookiePartition(value) {
    if (!value || typeof value !== 'object')
      return undefined
    const topLevelSite = String(value.topLevelSite ?? '')
    const url = validateSourceUrl(topLevelSite)
    return { topLevelSite: url.origin }
  }

  /**
   * ================================================================================
   * 步骤6：遍历顶层页面和同源 iframe
   * ================================================================================
   * 目标：让旧版 115 主文件 iframe 与新版顶层文件页共用同一套只读查询。
   * 数据源：顶层 document、可访问 iframe 文档与开放 Shadow DOM。
   * 操作：
   * 1) 递归收集同源 iframe，跳过跨域或尚未加载的文档
   * 2) 查询节点并沿 iframe 可见链判断最终显示状态
   */

  /** 递归收集顶层页面与可访问的 iframe 文档。 */
  function getAccessibleDocuments() {
    logger.info('开始收集可访问页面文档')

    const documents = [document]
    const visited = new Set(documents)
    for (let index = 0; index < documents.length; index += 1) {
      /** 6.1 每个文档继续查找内嵌 frame；跨域访问失败时保持只读跳过。 */
      const frames = documents[index].querySelectorAll('iframe, frame')
      frames.forEach((frame) => {
        try {
          const childDocument = frame.contentDocument
          if (childDocument?.documentElement && !visited.has(childDocument)) {
            visited.add(childDocument)
            documents.push(childDocument)
          }
        }
        catch {
          // 跨域 frame 不属于用户脚本可读范围。
        }
      })
    }

    logger.info('可访问页面文档收集完成', documents.length)
    return documents
  }

  /** 查询节点，使用 >>> 显式穿过开放 Shadow DOM。 */
  function queryDeep(selector, documents = getAccessibleDocuments()) {
    const parts = selector.split(/\s*>>>\s*/).filter(Boolean)
    if (parts.length === 0)
      return []
    let roots = documents
    let matches = []
    for (let index = 0; index < parts.length; index += 1) {
      matches = roots.flatMap(root =>
        Array.from(root.querySelectorAll(parts[index])),
      )
      if (index < parts.length - 1)
        roots = matches.map(element => element.shadowRoot).filter(Boolean)
    }
    return matches
  }

  /** 递归查询一个节点及其所有开放 Shadow DOM。 */
  function getDeepElements(root, selector) {
    const roots = [root]
    const results = []
    if (isElementNode(root) && root.shadowRoot)
      roots.push(root.shadowRoot)
    for (let index = 0; index < roots.length; index += 1) {
      const current = roots[index]
      results.push(...Array.from(current.querySelectorAll(selector)))
      const all = current.querySelectorAll('*')
      all.forEach((element) => {
        if (element.shadowRoot)
          roots.push(element.shadowRoot)
      })
    }
    return results
  }

  /** 读取普通 DOM 与开放 Shadow DOM 中的文本。 */
  function getNodeText(node) {
    const text = [node.textContent]
    getDeepElements(node, '*').forEach((element) => {
      if (element.shadowRoot)
        text.push(element.shadowRoot.textContent)
    })
    return normalizeText(text.filter(Boolean).join(' '))
  }

  /** 查找文字匹配的常见交互节点。 */
  function findTextCandidates(text, exact, documents) {
    return queryDeep(
      'button, a, [role="button"], [role="menuitem"]',
      documents,
    ).filter((element) => {
      const content = normalizeText(element.textContent)
      return exact ? content === text : content.includes(text)
    })
  }

  /** 输出稳定、短小的节点描述。 */
  function describeElement(element) {
    const rect = element.getBoundingClientRect()
    const attributes = {}
    for (const attribute of element.attributes) {
      if (
        attribute.name === 'id'
        || attribute.name === 'class'
        || attribute.name === 'content'
        || attribute.name === 'href'
        || attribute.name === 'poster'
        || attribute.name === 'src'
        || attribute.name === 'srcset'
        || attribute.name === 'title'
        || attribute.name.startsWith('aria-')
        || attribute.name.startsWith('data-')
      ) {
        attributes[attribute.name] = attribute.value.slice(0, 500)
      }
    }
    return {
      tag: element.tagName.toLowerCase(),
      text: normalizeText(element.textContent).slice(0, 1000),
      visible: isVisible(element),
      attributes,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    }
  }

  /** 判断跨 realm 节点是否属于 HTML 元素。 */
  function isHtmlElement(element) {
    const elementWindow = element?.ownerDocument?.defaultView
    return Boolean(elementWindow && element instanceof elementWindow.HTMLElement)
  }

  /** 判断跨 realm 节点是否属于输入框。 */
  function isTextInput(element) {
    const elementWindow = element?.ownerDocument?.defaultView
    return Boolean(
      elementWindow
      && (
        element instanceof elementWindow.HTMLInputElement
        || element instanceof elementWindow.HTMLTextAreaElement
      ),
    )
  }

  /** 判断跨 realm 节点是否属于 DOM Element。 */
  function isElementNode(element) {
    const elementWindow = element?.ownerDocument?.defaultView
    return Boolean(elementWindow && element instanceof elementWindow.Element)
  }

  /** 判断节点自身是否有可见尺寸和可见样式。 */
  function isLocallyVisible(element) {
    if (!isElementNode(element) || !element.isConnected)
      return false
    const rect = element.getBoundingClientRect()
    const elementWindow = element.ownerDocument.defaultView
    const style = elementWindow?.getComputedStyle(element)
    return Boolean(
      style
      && rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden',
    )
  }

  /** 判断节点自身及所属 iframe 链是否可见。 */
  function isVisible(element) {
    if (!isLocallyVisible(element))
      return false

    /** 6.2 iframe 内节点必须同时满足每一层宿主 frame 可见。 */
    const topWindow = document.defaultView
    let ownerWindow = element.ownerDocument.defaultView
    while (ownerWindow && ownerWindow !== topWindow) {
      let frameElement
      try {
        frameElement = ownerWindow.frameElement
      }
      catch {
        return false
      }
      if (!frameElement || !isLocallyVisible(frameElement))
        return false
      ownerWindow = frameElement.ownerDocument.defaultView
    }
    return ownerWindow === topWindow
  }

  /** 从详情文字和链接判断最终资料源。 */
  function inferSource(text, links) {
    for (const source of ['JavLibrary', 'JavBus', 'JavDB', 'MissAV']) {
      if (text.includes(source))
        return source
    }
    const joined = links.join(' ')
    if (/javlibrary/i.test(joined))
      return 'JavLibrary'
    if (/javbus/i.test(joined))
      return 'JavBus'
    if (/javdb/i.test(joined))
      return 'JavDB'
    if (/missav/i.test(joined))
      return 'MissAV'
    return null
  }

  /** 标准化页面文字，防止换行和重复空白污染 JSON。 */
  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /** 把异常转换为可跨进程传输的对象。 */
  function serializeError(error) {
    return {
      name: error?.name ?? 'Error',
      message: error?.message ?? String(error),
      stack: error?.stack,
    }
  }

  /** 非阻塞等待下一轮轮询。 */
  function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds))
  }
})()
