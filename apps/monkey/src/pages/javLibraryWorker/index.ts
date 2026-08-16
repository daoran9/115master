import {
  JavLibrary,
} from '@/utils/jav'
import { isSameAvNumber, normalizeAvNumber } from '@/utils/jav/jav'
import {
  clearJavLibraryWorkerRequest,
  markJavLibraryWorkerReady,
  publishJavLibraryWorkerResult,
  takeJavLibraryWorkerRequest,
} from '@/utils/jav/javLibraryWorker'
import { appLogger } from '@/utils/logger'

const logger = appLogger.sub('JavLibraryWorker')
const POLL_INTERVAL_MS = 500
const FETCH_TIMEOUT_MS = 15_000
const DIAGNOSTIC_ATTRIBUTE_PREFIX = 'data-115master-javlibrary-worker'
let processing = false

type WorkerDiagnosticState = 'error' | 'processing' | 'ready' | 'starting' | 'success'

interface WorkerDiagnosticUpdate {
  state?: WorkerDiagnosticState
  heartbeatAt?: number
  currentAvNumber?: null | string
  lastAvNumber?: string
  lastError?: null | string
  lastSource?: string
}

/** 把 worker 现场状态写到不可见的 html 属性，供只读测试桥采集。 */
function updateWorkerDiagnostic(update: WorkerDiagnosticUpdate) {
  const root = document.documentElement
  if (!root)
    return

  const attributes = {
    [`${DIAGNOSTIC_ATTRIBUTE_PREFIX}-state`]: update.state,
    [`${DIAGNOSTIC_ATTRIBUTE_PREFIX}-heartbeat-at`]: update.heartbeatAt,
    [`${DIAGNOSTIC_ATTRIBUTE_PREFIX}-current-number`]: update.currentAvNumber,
    [`${DIAGNOSTIC_ATTRIBUTE_PREFIX}-last-number`]: update.lastAvNumber,
    [`${DIAGNOSTIC_ATTRIBUTE_PREFIX}-last-error`]: update.lastError === null
      ? null
      : update.lastError?.slice(0, 240),
    [`${DIAGNOSTIC_ATTRIBUTE_PREFIX}-last-source`]: update.lastSource,
  }

  Object.entries(attributes).forEach(([name, value]) => {
    if (value === null)
      root.removeAttribute(name)
    else if (value !== undefined)
      root.setAttribute(name, String(value))
  })
}

/** 用第一方 Cookie 请求一个 JavLibrary 页面，并限制单次占槽时间。 */
async function fetchJavLibraryPage(url: string) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await window.fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    })
    const html = await response.text()
    if (!response.ok)
      throw new Error(`JavLibrary HTTP ${response.status}`)
    return {
      html,
      url: response.url || url,
    }
  }
  finally {
    window.clearTimeout(timeoutId)
  }
}

/** 处理一个来自 115 页面的 JavLibrary 任务。 */
async function processRequest() {
  if (processing)
    return

  const request = takeJavLibraryWorkerRequest()
  if (!request)
    return

  processing = true
  updateWorkerDiagnostic({
    currentAvNumber: request.avNumber,
    lastError: null,
    state: 'processing',
  })

  /*
   * ================================================================================
   * 步骤1：用 JavLibrary 第一方页面会话加载详情
   * ================================================================================
   * 目标：复用当前顶层页面的 Cloudflare Cookie，绕过 GM 跨域分区限制。
   * 数据源：工作标签页同源 fetch 返回的搜索页或详情页。
   * 操作：
   * 1) 请求番号搜索 URL 并跟随站内跳转
   * 2) 用现有 JavLibrary 解析器生成完整结构化资料
   */
  logger.info('开始处理 JavLibrary 后台任务', request.avNumber)
  try {
    const parser = new JavLibrary()
    parser.searchUrl = request.searchUrl
    const expectedAvNumber = normalizeAvNumber(request.avNumber)
    const searchPage = await fetchJavLibraryPage(request.searchUrl)
    const detailUrl = parser.getDetailUrl(searchPage.html, expectedAvNumber)
    const detailPage = detailUrl
      ? await fetchJavLibraryPage(detailUrl)
      : searchPage
    parser.detailUrl = detailPage.url
    const info = await parser.parseInfo(detailPage.html)
    if (!info || !isSameAvNumber(expectedAvNumber, info.avNumber))
      throw new Error('JavLibrary 页面没有精确番号资料')

    publishJavLibraryWorkerResult({
      id: request.id,
      info,
    })
    updateWorkerDiagnostic({
      lastAvNumber: request.avNumber,
      lastError: null,
      lastSource: info.source,
      state: 'success',
    })
    logger.info('JavLibrary 后台任务完成', request.avNumber)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publishJavLibraryWorkerResult({
      id: request.id,
      error: message,
    })
    updateWorkerDiagnostic({
      lastAvNumber: request.avNumber,
      lastError: message,
      state: 'error',
    })
    logger.warn('JavLibrary 后台任务失败', request.avNumber, message)
  }
  finally {
    clearJavLibraryWorkerRequest(request.id)
    updateWorkerDiagnostic({ currentAvNumber: null })
    processing = false
  }
}

/** 启动无界面接管的工作轮询，不改动资料源页面原生 DOM。 */
export function javLibraryWorkerPage() {
  /*
   * ================================================================================
   * 步骤2：启动 JavLibrary 后台工作页
   * ================================================================================
   * 目标：保持标签页可复用，并按串行队列处理大量视频番号。
   * 数据源：GM 存储中的工作请求。
   * 操作：
   * 1) 写入心跳让 115 页面复用当前标签
   * 2) 定时取任务，完成后回传结果
  */
  logger.info('开始启动 JavLibrary 后台工作页')
  const startedAt = Date.now()
  document.documentElement?.setAttribute(
    DIAGNOSTIC_ATTRIBUTE_PREFIX,
    __115MASTER_VERSION__,
  )
  document.documentElement?.setAttribute(
    `${DIAGNOSTIC_ATTRIBUTE_PREFIX}-started-at`,
    String(startedAt),
  )
  updateWorkerDiagnostic({
    heartbeatAt: startedAt,
    state: 'starting',
  })
  markJavLibraryWorkerReady()
  updateWorkerDiagnostic({ state: 'ready' })
  window.setInterval(() => {
    const heartbeatAt = Date.now()
    markJavLibraryWorkerReady()
    updateWorkerDiagnostic({ heartbeatAt })
    void processRequest()
  }, POLL_INTERVAL_MS)
  void processRequest()
  logger.info('JavLibrary 后台工作页启动完成')
}
