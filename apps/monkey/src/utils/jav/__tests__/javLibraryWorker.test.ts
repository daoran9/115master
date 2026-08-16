import type { JavInfo } from '../jav'
import { afterEach, expect, it, vi } from 'vitest'

const testLogger = {
  info: vi.fn(),
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('javLibrary 工作页等待共享槽空闲后再提交任务', async () => {
  /*
   * ================================================================================
   * 步骤1：验证新旧 115 页面共享工作槽
   * ================================================================================
   * 目标：另一页面已有请求时不覆盖，释放后再提交当前页面任务。
   * 数据源：模拟 GM 跨标签存储和结果监听。
   * 操作：
   * 1) 预置其他页面请求并推进重试计时
   * 2) 清除旧请求，回传当前任务结果并核对 Promise
   */
  testLogger.info('开始验证 JavLibrary 共享工作槽')
  vi.useFakeTimers()

  const store = new Map<string, unknown>([
    ['115master-javlibrary-worker-request', {
      id: 'other-page-task',
      avNumber: 'OTHER-001',
      searchUrl: 'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=OTHER-001',
    }],
  ])
  let resultListener: ((
    key: string,
    oldValue: unknown,
    newValue: unknown,
    remote: boolean,
  ) => void) | undefined

  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('GM_getValue', (key: string, defaultValue?: unknown) =>
    store.has(key) ? store.get(key) : defaultValue)
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value))
  vi.stubGlobal('GM_deleteValue', (key: string) => store.delete(key))
  vi.stubGlobal('GM_openInTab', vi.fn(() => ({ closed: false, onclose: null })))
  vi.stubGlobal('GM_addValueChangeListener', (
    _key: string,
    listener: typeof resultListener,
  ) => {
    resultListener = listener
    return 1
  })

  const { requestJavLibraryInfo } = await import('../javLibraryWorker')
  const resultPromise = requestJavLibraryInfo(
    'SORA-636',
    'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=SORA-636',
  )

  await vi.advanceTimersByTimeAsync(500)
  expect((store.get('115master-javlibrary-worker-request') as { id: string }).id)
    .toBe('other-page-task')

  store.delete('115master-javlibrary-worker-request')
  await vi.advanceTimersByTimeAsync(500)
  const request = store.get('115master-javlibrary-worker-request') as {
    id: string
  }
  expect(request.id).not.toBe('other-page-task')

  const info: JavInfo = {
    source: 'JavLibrary' as JavInfo['source'],
    baseUrl: 'https://www.javlibrary.com/cn/',
    detailUrl: 'https://www.javlibrary.com/cn/example.html',
    searchUrl: 'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=SORA-636',
    avNumber: 'SORA-636',
    title: '示例标题',
  }
  resultListener?.(
    '115master-javlibrary-worker-result',
    undefined,
    { id: request.id, info },
    true,
  )

  await expect(resultPromise).resolves.toEqual(info)
  testLogger.info('JavLibrary 共享工作槽验证完成')
})

it('值变更监听漏发时通过轮询接收 JavLibrary 工作结果', async () => {
  /*
   * ================================================================================
   * 步骤1：验证跨标签结果轮询兜底
   * ================================================================================
   * 目标：Tampermonkey 没有触发值变更监听时，当前任务仍能完成并释放队列。
   * 数据源：模拟 GM 存储中由工作页写入的结果。
   * 操作：
   * 1) 提交任务但不调用值变更监听
   * 2) 写入匹配结果并推进轮询计时
   */
  testLogger.info('开始验证 JavLibrary 工作结果轮询兜底')
  vi.useFakeTimers()

  const store = new Map<string, unknown>()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('GM_getValue', (key: string, defaultValue?: unknown) =>
    store.has(key) ? store.get(key) : defaultValue)
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value))
  vi.stubGlobal('GM_deleteValue', (key: string) => store.delete(key))
  vi.stubGlobal('GM_openInTab', vi.fn(() => ({ closed: false, onclose: null })))
  vi.stubGlobal('GM_addValueChangeListener', vi.fn(() => 1))

  const { requestJavLibraryInfo } = await import('../javLibraryWorker')
  const resultPromise = requestJavLibraryInfo(
    'LULU-410',
    'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=LULU-410',
  )
  await vi.advanceTimersByTimeAsync(50)

  const request = store.get('115master-javlibrary-worker-request') as { id: string }
  const info: JavInfo = {
    source: 'JavLibrary' as JavInfo['source'],
    baseUrl: 'https://www.javlibrary.com/cn/',
    detailUrl: 'https://www.javlibrary.com/cn/example.html',
    searchUrl: 'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=LULU-410',
    avNumber: 'LULU-410',
    title: '轮询示例标题',
  }
  store.set('115master-javlibrary-worker-result', { id: request.id, info })
  store.delete('115master-javlibrary-worker-request')
  await vi.advanceTimersByTimeAsync(300)

  await expect(resultPromise).resolves.toEqual(info)
  testLogger.info('JavLibrary 工作结果轮询兜底验证完成')
})

it('后台标签心跳降频时复用现有 JavLibrary 工作页', async () => {
  /*
   * ================================================================================
   * 步骤1：验证后台 worker 心跳宽限
   * ================================================================================
   * 目标：浏览器把后台计时器降到一分钟时，不重复打开 JavLibrary 主页。
   * 数据源：一分钟前写入的 GM 就绪时间。
   * 操作：
   * 1) 提交新的详情任务
   * 2) 核对任务复用现有工作页且不调用 GM_openInTab
   */
  testLogger.info('开始验证 JavLibrary 后台 worker 心跳宽限')
  vi.useFakeTimers()
  vi.setSystemTime(120_000)

  const store = new Map<string, unknown>([
    ['115master-javlibrary-worker-ready', 60_000],
  ])
  const openInTab = vi.fn(() => ({ closed: false, onclose: null }))
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('GM_getValue', (key: string, defaultValue?: unknown) =>
    store.has(key) ? store.get(key) : defaultValue)
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value))
  vi.stubGlobal('GM_deleteValue', (key: string) => store.delete(key))
  vi.stubGlobal('GM_openInTab', openInTab)
  vi.stubGlobal('GM_addValueChangeListener', vi.fn(() => 1))

  const { createJavLibraryWorkerRequest } = await import('../javLibraryWorker')
  const handle = createJavLibraryWorkerRequest(
    'BF-304',
    'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=BF-304',
  )
  await vi.advanceTimersByTimeAsync(50)

  expect(openInTab).not.toHaveBeenCalled()
  handle.cancel()
  await expect(handle.promise).resolves.toBeUndefined()
  testLogger.info('JavLibrary 后台 worker 心跳宽限验证完成')
})

it('javLibrary 工作页自动回收失去所属页面的遗留任务', async () => {
  /*
   * ================================================================================
   * 步骤1：验证遗留共享槽回收
   * ================================================================================
   * 目标：页面刷新后留下的旧任务不能永久阻塞新页面详情。
   * 数据源：超过一分钟的共享请求和当前页面的新请求。
   * 操作：
   * 1) 预置过期请求并提交新任务
   * 2) 核对共享槽被当前任务接管
   */
  testLogger.info('开始验证 JavLibrary 遗留共享槽回收')
  vi.useFakeTimers()
  vi.setSystemTime(120_000)

  const store = new Map<string, unknown>([
    ['115master-javlibrary-worker-request', {
      id: '1000-old-page-task',
      createdAt: 1000,
      avNumber: 'OLD-001',
      searchUrl: 'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=OLD-001',
    }],
  ])
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('GM_getValue', (key: string, defaultValue?: unknown) =>
    store.has(key) ? store.get(key) : defaultValue)
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value))
  vi.stubGlobal('GM_deleteValue', (key: string) => store.delete(key))
  vi.stubGlobal('GM_openInTab', vi.fn(() => ({ closed: false, onclose: null })))
  vi.stubGlobal('GM_addValueChangeListener', vi.fn(() => 1))

  const { createJavLibraryWorkerRequest } = await import('../javLibraryWorker')
  const handle = createJavLibraryWorkerRequest(
    'NEW-001',
    'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=NEW-001',
  )
  await vi.advanceTimersByTimeAsync(50)

  expect((store.get('115master-javlibrary-worker-request') as { avNumber: string }).avNumber)
    .toBe('NEW-001')
  handle.cancel()
  await expect(handle.promise).resolves.toBeUndefined()
  testLogger.info('JavLibrary 遗留共享槽回收验证完成')
})

it('取消 JavLibrary 工作任务时释放本页占用的共享槽', async () => {
  /*
   * ================================================================================
   * 步骤1：验证工作任务取消
   * ================================================================================
   * 目标：GM 通道先返回后，后台队列不再保留无用任务。
   * 数据源：当前页面已提交的共享请求。
   * 操作：
   * 1) 提交任务并确认占槽
   * 2) 取消任务并核对请求和 Promise 都已释放
   */
  testLogger.info('开始验证 JavLibrary 工作任务取消')
  vi.useFakeTimers()

  const store = new Map<string, unknown>()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('GM_getValue', (key: string, defaultValue?: unknown) =>
    store.has(key) ? store.get(key) : defaultValue)
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value))
  vi.stubGlobal('GM_deleteValue', (key: string) => store.delete(key))
  vi.stubGlobal('GM_openInTab', vi.fn(() => ({ closed: false, onclose: null })))
  vi.stubGlobal('GM_addValueChangeListener', vi.fn(() => 1))

  const { createJavLibraryWorkerRequest } = await import('../javLibraryWorker')
  const handle = createJavLibraryWorkerRequest(
    'CANCEL-001',
    'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=CANCEL-001',
  )
  await vi.advanceTimersByTimeAsync(50)
  expect(store.has('115master-javlibrary-worker-request')).toBe(true)

  handle.cancel()
  expect(store.has('115master-javlibrary-worker-request')).toBe(false)
  await expect(handle.promise).resolves.toBeUndefined()
  testLogger.info('JavLibrary 工作任务取消验证完成')
})
