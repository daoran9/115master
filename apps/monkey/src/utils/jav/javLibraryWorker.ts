import type { JavInfo } from './jav'

/** JavLibrary 后台工作页固定地址。 */
export const JAVLIBRARY_WORKER_URL = 'https://www.javlibrary.com/cn/'

const logger = {
  info: (...messages: unknown[]) => console.info('[JavLibraryWorkerClient]', ...messages),
}
const REQUEST_KEY = '115master-javlibrary-worker-request'
const RESULT_KEY = '115master-javlibrary-worker-result'
const READY_KEY = '115master-javlibrary-worker-ready'
const REQUEST_TIMEOUT_MS = 45_000
const REQUEST_STALE_MS = 60_000
const READY_TTL_MS = 90_000
const RESULT_POLL_INTERVAL_MS = 250

export interface JavLibraryWorkerRequest {
  id: string
  createdAt?: number
  avNumber: string
  searchUrl: string
}

export interface JavLibraryWorkerResult {
  id: string
  info?: JavInfo
  error?: string
}

interface GMWorkerGlobal {
  GM_addValueChangeListener?: (
    key: string,
    listener: (
      key: string,
      oldValue: unknown,
      newValue: unknown,
      remote: boolean,
    ) => void,
  ) => unknown
  GM_deleteValue?: (key: string) => void
  GM_getValue?: <T>(key: string, defaultValue?: T) => T
  GM_setValue?: (key: string, value: unknown) => void
}

const gm = globalThis as typeof globalThis & GMWorkerGlobal

interface WorkerTask {
  request: JavLibraryWorkerRequest
  resolve: (info: JavInfo | undefined) => void
  resultPollId?: number
  timeoutId?: number
}

export interface JavLibraryWorkerHandle {
  promise: Promise<JavInfo | undefined>
  cancel: () => void
}

const localQueue: WorkerTask[] = []
let activeTask: WorkerTask | undefined
let listenerRegistered = false

/** 判断当前页面是否具备 Tampermonkey 跨标签存储能力。 */
function hasWorkerStorageApi() {
  return typeof gm.GM_getValue === 'function'
    && typeof gm.GM_setValue === 'function'
    && typeof gm.GM_addValueChangeListener === 'function'
    && typeof gm.GM_deleteValue === 'function'
}

/** 只复用用户已经打开的 JavLibrary 页面，不由文件列表主动打开外站标签。 */
function hasReadyWorker() {
  if (!hasWorkerStorageApi())
    return false
  return Date.now() - Number(gm.GM_getValue!(READY_KEY, 0)) < READY_TTL_MS
}

/** 启动一次跨标签结果监听。 */
function ensureResultListener() {
  if (!hasWorkerStorageApi() || listenerRegistered || typeof gm.GM_addValueChangeListener !== 'function')
    return

  listenerRegistered = true
  gm.GM_addValueChangeListener(RESULT_KEY, (_key, _oldValue, newValue, remote) => {
    if (!remote || !newValue || typeof newValue !== 'object')
      return
    handleWorkerResult(newValue as JavLibraryWorkerResult)
  })
}

/**
 * ================================================================================
 * 步骤1：轮询跨标签结果
 * ================================================================================
 * 目标：Tampermonkey 偶发漏发值变更事件时，详情队列仍能继续出队。
 * 数据源：GM 存储中的 JavLibrary 工作页结果。
 * 操作：
 * 1) 核对结果 ID 是否属于当前任务
 * 2) 未命中时短间隔重试，命中后复用统一结果处理
 */
function pollWorkerResult(task: WorkerTask) {
  if (activeTask?.request.id !== task.request.id)
    return

  const result = gm.GM_getValue!(RESULT_KEY) as JavLibraryWorkerResult | undefined
  if (result?.id === task.request.id) {
    logger.info('开始通过轮询接收 JavLibrary 工作结果', task.request.avNumber)
    handleWorkerResult(result)
    logger.info('JavLibrary 工作结果轮询接收完成', task.request.avNumber)
    return
  }

  task.resultPollId = window.setTimeout(
    () => pollWorkerResult(task),
    RESULT_POLL_INTERVAL_MS,
  )
}

/** 清理单个工作任务的超时和结果轮询计时器。 */
function clearWorkerTaskTimers(task: WorkerTask) {
  if (task.timeoutId !== undefined)
    window.clearTimeout(task.timeoutId)
  if (task.resultPollId !== undefined)
    window.clearTimeout(task.resultPollId)
  task.timeoutId = undefined
  task.resultPollId = undefined
}

/** 当前标签确认共享请求槽后再启动超时计时。 */
function confirmWorkerTask(task: WorkerTask) {
  if (activeTask?.request.id !== task.request.id)
    return

  const stored = gm.GM_getValue!(REQUEST_KEY) as JavLibraryWorkerRequest | undefined
  if (stored?.id !== task.request.id) {
    window.setTimeout(() => claimWorkerSlot(task), 100 + Math.random() * 100)
    return
  }

  task.timeoutId = window.setTimeout(() => {
    if (activeTask?.request.id !== task.request.id)
      return
    clearWorkerTaskTimers(task)
    clearJavLibraryWorkerRequest(task.request.id)
    activeTask = undefined
    task.resolve(undefined)
    pumpWorkerQueue()
  }, REQUEST_TIMEOUT_MS)
  pollWorkerResult(task)
}

/** 从新旧任务结构中读取创建时间，用于清理失去所属页面的共享槽。 */
function getWorkerRequestCreatedAt(request: JavLibraryWorkerRequest) {
  if (Number.isFinite(request.createdAt))
    return Number(request.createdAt)
  const timestamp = Number(request.id.split('-', 1)[0])
  return Number.isFinite(timestamp) ? timestamp : 0
}

/** 判断共享槽是否已经超过单次工作任务的合理生命周期。 */
function isWorkerRequestStale(request: JavLibraryWorkerRequest) {
  const createdAt = getWorkerRequestCreatedAt(request)
  return createdAt > 0 && Date.now() - createdAt >= REQUEST_STALE_MS
}

/** 等待共享请求槽空闲，避免新旧 115 页面互相覆盖任务。 */
function claimWorkerSlot(task: WorkerTask) {
  if (activeTask?.request.id !== task.request.id)
    return

  const stored = gm.GM_getValue!(REQUEST_KEY) as JavLibraryWorkerRequest | undefined
  if (stored?.id && stored.id !== task.request.id) {
    /*
     * ================================================================================
     * 步骤1：回收失去所属页面的共享任务
     * ================================================================================
     * 目标：页面刷新或关闭后，旧请求不能永久阻塞当前详情队列。
     * 数据源：GM 存储中的共享请求及其创建时间。
     * 操作：
     * 1) 超过生命周期时只删除当前读到的旧请求
     * 2) 重新竞争共享槽，保留多页面互斥
     */
    if (isWorkerRequestStale(stored)) {
      logger.info('开始回收 JavLibrary 遗留共享任务', stored.avNumber)
      gm.GM_deleteValue!(REQUEST_KEY)
      logger.info('JavLibrary 遗留共享任务回收完成', stored.avNumber)
      window.setTimeout(() => claimWorkerSlot(task), 0)
      return
    }
    window.setTimeout(() => claimWorkerSlot(task), 100 + Math.random() * 100)
    return
  }

  gm.GM_setValue!(REQUEST_KEY, task.request)
  window.setTimeout(() => confirmWorkerTask(task), 25)
}

/** 取消尚未完成的本页工作任务，不影响其他页面已经占用的共享槽。 */
function cancelWorkerTask(task: WorkerTask) {
  const queuedIndex = localQueue.findIndex(item => item.request.id === task.request.id)
  if (queuedIndex >= 0) {
    localQueue.splice(queuedIndex, 1)
    task.resolve(undefined)
    return
  }
  if (activeTask?.request.id !== task.request.id)
    return

  clearWorkerTaskTimers(task)
  clearJavLibraryWorkerRequest(task.request.id)
  activeTask = undefined
  task.resolve(undefined)
  pumpWorkerQueue()
}

/** 等待工作页并申请跨标签共享请求槽。 */
function dispatchWorkerTask(task: WorkerTask) {
  if (!hasWorkerStorageApi()) {
    activeTask = undefined
    task.resolve(undefined)
    pumpWorkerQueue()
    return
  }
  ensureResultListener()
  claimWorkerSlot(task)
}

/** 处理工作页回传，避免重复完成同一个任务。 */
function handleWorkerResult(result: JavLibraryWorkerResult) {
  if (activeTask?.request.id !== result.id)
    return

  const task = activeTask
  activeTask = undefined
  clearWorkerTaskTimers(task)
  task.resolve(result.info)
  pumpWorkerQueue()
}

/** 串行发送任务，避免多个文件同时覆盖单槽位请求。 */
function pumpWorkerQueue() {
  if (activeTask || localQueue.length === 0)
    return
  activeTask = localQueue.shift()
  if (activeTask)
    dispatchWorkerTask(activeTask)
}

/** 请求后台 JavLibrary 工作页返回结构化详情。 */
export function createJavLibraryWorkerRequest(
  avNumber: string,
  searchUrl: string,
): JavLibraryWorkerHandle {
  if (!hasReadyWorker()) {
    return {
      promise: Promise.resolve(undefined),
      cancel: () => {},
    }
  }

  let task = undefined as unknown as WorkerTask
  const promise = new Promise<JavInfo | undefined>((resolve) => {
    task = {
      request: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: Date.now(),
        avNumber,
        searchUrl,
      },
      resolve,
    }
    localQueue.push(task)
    pumpWorkerQueue()
  })
  return {
    promise,
    cancel: () => cancelWorkerTask(task),
  }
}

/** 请求后台 JavLibrary 工作页返回结构化详情。 */
export function requestJavLibraryInfo(
  avNumber: string,
  searchUrl: string,
): Promise<JavInfo | undefined> {
  return createJavLibraryWorkerRequest(avNumber, searchUrl).promise
}

/** 记录工作页心跳，供请求端判断是否需要打开新标签。 */
export function markJavLibraryWorkerReady() {
  if (!hasWorkerStorageApi())
    return
  gm.GM_setValue!(READY_KEY, Date.now())
}

/** 读取待处理任务；工作页完成前保留槽位，防止其他页面覆盖。 */
export function takeJavLibraryWorkerRequest(): JavLibraryWorkerRequest | undefined {
  if (!hasWorkerStorageApi())
    return undefined
  const request = gm.GM_getValue!(REQUEST_KEY) as JavLibraryWorkerRequest | undefined
  if (!request || typeof request !== 'object' || !request.id)
    return undefined
  return request
}

/** 只清除当前任务占用的共享槽，避免误删另一页面的新任务。 */
export function clearJavLibraryWorkerRequest(requestId: string) {
  if (!hasWorkerStorageApi())
    return
  const request = gm.GM_getValue!(REQUEST_KEY) as JavLibraryWorkerRequest | undefined
  if (request?.id === requestId)
    gm.GM_deleteValue!(REQUEST_KEY)
}

/** 向请求端回传工作页解析结果。 */
export function publishJavLibraryWorkerResult(result: JavLibraryWorkerResult) {
  if (!hasWorkerStorageApi())
    return
  gm.GM_setValue!(RESULT_KEY, result)
}
