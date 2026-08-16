import { afterEach, expect, it, vi } from 'vitest'

const testLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  sub: () => testLogger,
}

vi.mock('@/utils/logger', () => ({
  appLogger: {
    sub: () => testLogger,
  },
}))

vi.mock('@/utils/jav', () => ({
  JavLibrary: class {},
}))

vi.mock('@/utils/jav/jav', () => ({
  isSameAvNumber: vi.fn(),
  normalizeAvNumber: (value: string) => value,
}))

vi.mock('@/utils/jav/javLibraryWorker', () => ({
  clearJavLibraryWorkerRequest: vi.fn(),
  markJavLibraryWorkerReady: vi.fn(),
  publishJavLibraryWorkerResult: vi.fn(),
  takeJavLibraryWorkerRequest: vi.fn(() => undefined),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('javlibrary 工作页写入版本、就绪状态和持续心跳', async () => {
  /*
   * ================================================================================
   * 步骤1：验证 JavLibrary worker 现场诊断
   * ================================================================================
   * 目标：测试桥无需读取控制台即可判断生产脚本是否在资料源页运行。
   * 数据源：worker 写入 documentElement 的不可见 data 属性。
   * 操作：
   * 1) 启动没有待处理任务的 worker
   * 2) 推进轮询时间并核对版本、状态和心跳
   */
  testLogger.info('开始验证 JavLibrary worker 现场诊断')
  vi.useFakeTimers()
  vi.setSystemTime(10_000)

  const attributes = new Map<string, string>()
  const documentElement = {
    removeAttribute: (name: string) => attributes.delete(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  }
  const store = new Map<string, unknown>()

  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('document', { documentElement })
  vi.stubGlobal('__115MASTER_VERSION__', '2.0.0-beta.41')
  vi.stubGlobal('GM_getValue', (key: string, defaultValue?: unknown) =>
    store.has(key) ? store.get(key) : defaultValue)
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value))
  vi.stubGlobal('GM_deleteValue', (key: string) => store.delete(key))

  const { javLibraryWorkerPage } = await import('../index')
  javLibraryWorkerPage()

  expect(attributes.get('data-115master-javlibrary-worker')).toBe('2.0.0-beta.41')
  expect(attributes.get('data-115master-javlibrary-worker-state')).toBe('ready')
  expect(attributes.get('data-115master-javlibrary-worker-heartbeat-at')).toBe('10000')

  vi.advanceTimersByTime(500)
  expect(attributes.get('data-115master-javlibrary-worker-heartbeat-at')).toBe('10500')
  testLogger.info('JavLibrary worker 现场诊断验证完成')
})
