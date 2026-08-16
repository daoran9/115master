import type { JavInfo } from '../jav'
import { afterEach, expect, it, vi } from 'vitest'

const { createWorkerRequest, workerCancel, workerState } = vi.hoisted(() => {
  const state = {
    resolve: undefined as unknown as (info: JavInfo | undefined) => void,
  }
  const cancel = vi.fn(() => state.resolve?.(undefined))
  return {
    workerState: state,
    workerCancel: cancel,
    createWorkerRequest: vi.fn(() => ({
      promise: new Promise<JavInfo | undefined>((resolve) => {
        state.resolve = resolve
      }),
      cancel,
    })),
  }
})

vi.mock('../javLibraryWorker', () => ({
  createJavLibraryWorkerRequest: createWorkerRequest,
}))
vi.mock('@/utils/logger', () => ({
  appLogger: {
    sub: () => ({
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}))
vi.mock('@/utils/request/gmRequest', () => ({
  GMRequest: class {},
}))
vi.mock('@/utils/cache/javCache', () => ({
  javCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}))

const { JAV_SOURCE } = await import('../jav')
const { JavLibrary } = await import('../javLibrary')
const testLogger = {
  info: vi.fn(),
}

function info(avNumber: string): JavInfo {
  return {
    source: JAV_SOURCE.JAVLIBRARY,
    baseUrl: 'https://www.javlibrary.com/cn/',
    detailUrl: `https://www.javlibrary.com/cn/${avNumber}.html`,
    searchUrl: `https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=${avNumber}`,
    avNumber,
    title: avNumber,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('第一方工作页及时返回时不启动 GM 后备请求', async () => {
  /*
   * ================================================================================
   * 步骤1：验证第一方通道优先
   * ================================================================================
   * 目标：工作页可用时不产生重复 GM 请求。
   * 数据源：立即完成的第一方工作任务和延迟 GM 通道。
   * 操作：
   * 1) 提交番号并返回精确工作页资料
   * 2) 核对 GM 计时器被取消
   */
  testLogger.info('开始验证 JavLibrary 第一方通道优先')
  vi.useFakeTimers()
  const parser = new JavLibrary()
  const gmRequest = vi.spyOn(
    parser as unknown as {
      requestInfoByGM: (
        avNumber: string,
        signal?: AbortSignal,
      ) => Promise<JavInfo | undefined>
    },
    'requestInfoByGM',
  ).mockResolvedValue(info('FAST-001'))

  const resultPromise = parser.getInfoByAvNumber('FAST-001')
  workerState.resolve(info('FAST-001'))

  await expect(resultPromise).resolves.toMatchObject({ avNumber: 'FAST-001' })
  await vi.runAllTimersAsync()
  expect(gmRequest).not.toHaveBeenCalled()
  testLogger.info('JavLibrary 第一方通道优先验证完成')
})

it('工作队列阻塞时采用 GM 精确结果并取消后台任务', async () => {
  /*
   * ================================================================================
   * 步骤1：验证 GM 并发回退
   * ================================================================================
   * 目标：单槽工作队列阻塞时，列表详情仍能及时显示。
   * 数据源：未完成的工作任务和 1.2 秒后返回的 GM 精确资料。
   * 操作：
   * 1) 推进 GM 延迟计时器
   * 2) 核对结果来源和后台取消动作
   */
  testLogger.info('开始验证 JavLibrary GM 并发回退')
  vi.useFakeTimers()
  const parser = new JavLibrary()
  const gmRequest = vi.spyOn(
    parser as unknown as {
      requestInfoByGM: (
        avNumber: string,
        signal?: AbortSignal,
      ) => Promise<JavInfo | undefined>
    },
    'requestInfoByGM',
  ).mockResolvedValue(info('FALLBACK-001'))

  const resultPromise = parser.getInfoByAvNumber('FALLBACK-001')
  await vi.advanceTimersByTimeAsync(1200)

  await expect(resultPromise).resolves.toMatchObject({ avNumber: 'FALLBACK-001' })
  expect(gmRequest).toHaveBeenCalledWith('FALLBACK001', expect.anything())
  expect(workerCancel).toHaveBeenCalledOnce()
  testLogger.info('JavLibrary GM 并发回退验证完成')
})

it('取消已启动的 JavLibrary GM 回退请求', async () => {
  /*
   * ================================================================================
   * 步骤1：验证 GM 请求取消链路
   * ================================================================================
   * 目标：来源等待超时后中断已经启动的 GM 请求，避免旧面板拖住后续详情。
   * 数据源：未完成的第一方任务和监听 AbortSignal 的 GM 请求。
   * 操作：
   * 1) 推进延迟并启动 GM 回退
   * 2) 取消番号传输并核对信号状态
   */
  testLogger.info('开始验证 JavLibrary GM 请求取消链路')
  vi.useFakeTimers()
  const parser = new JavLibrary()
  let requestSignal: AbortSignal | undefined
  const gmRequest = vi.spyOn(
    parser as unknown as {
      requestInfoByGM: (
        avNumber: string,
        signal?: AbortSignal,
      ) => Promise<JavInfo | undefined>
    },
    'requestInfoByGM',
  ).mockImplementation(async (_avNumber, signal) => {
    requestSignal = signal
    return await new Promise<JavInfo | undefined>((resolve) => {
      signal?.addEventListener('abort', () => resolve(undefined), { once: true })
    })
  })

  /** 1.1 GM 请求启动后取消同一番号的全部传输。 */
  const resultPromise = parser.getInfoByAvNumber('CANCEL-001')
  await vi.advanceTimersByTimeAsync(1200)
  parser.cancelInfoRequest('CANCEL-001')

  /** 1.2 两条传输都结束，且 GM 请求收到中断信号。 */
  await expect(resultPromise).rejects.toThrow('未找到番号')
  expect(gmRequest).toHaveBeenCalledOnce()
  expect(requestSignal?.aborted).toBe(true)
  testLogger.info('JavLibrary GM 请求取消链路验证完成')
})
