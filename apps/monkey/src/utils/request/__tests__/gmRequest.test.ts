import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GMRequest } from '../gmRequest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  abort: vi.fn(),
}))

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_info: { userAgentData: { brands: [] } },
  GM_xmlhttpRequest: mocks.request,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockImplementation((options) => {
    mocks.abort.mockImplementation(() => options.onabort?.())
    return { abort: mocks.abort }
  })
})

describe('gm request', () => {
  it('aborts the underlying request when its signal is cancelled', async () => {
    const controller = new AbortController()
    const pending = new GMRequest().get('https://example.com/image', {
      signal: controller.signal,
    })

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.abort).toHaveBeenCalledOnce()
  })

  it('forwards supplied cookies and their top-level partition', async () => {
    /**
     * ================================================================================
     * 步骤1：验证 GM 请求 Cookie 分区
     * ================================================================================
     * 目标：跨域请求可以复用正常浏览站点签发的分区 Cookie。
     * 数据源：JavLibrary 的成人确认 Cookie 和顶层站点键。
     * 操作：
     * 1) 发起带 Cookie 分区的请求
     * 2) 核对 Tampermonkey 收到的完整参数
     */
    const controller = new AbortController()
    const pending = new GMRequest().get('https://www.javlibrary.com/cn/', {
      cookie: 'over18=18',
      cookiePartition: {
        topLevelSite: 'https://javlibrary.com',
      },
      signal: controller.signal,
    })

    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      cookie: 'over18=18',
      cookiePartition: {
        topLevelSite: 'https://javlibrary.com',
      },
      headers: {},
    }))

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects an invalid status before reading the response body', async () => {
    /**
     * ================================================================================
     * 步骤1：验证响应头安全门禁
     * ================================================================================
     * 目标：Range 请求收到 200 时立即中止，避免继续读取整文件。
     * 数据源：GM readyState=2 响应头事件。
     * 操作：
     * 1) 发起带状态校验的请求
     * 2) 模拟 200 响应头并核对中止结果
     */
    const pending = new GMRequest().get('https://example.com/video.mp4', {
      validateResponse: ({ status }) => {
        if (status !== 206)
          throw new Error('expected 206')
      },
    })
    const options = mocks.request.mock.calls[0]![0]

    // 1.1 响应正文尚未到达时触发状态校验
    options.onreadystatechange({
      readyState: 2,
      responseHeaders: 'content-length: 1000',
      status: 200,
      statusText: 'OK',
    })

    // 1.2 原始请求被终止，上层收到明确的 Range 错误
    await expect(pending).rejects.toThrow('expected 206')
    expect(mocks.abort).toHaveBeenCalledOnce()
  })

  it('forwards bounded response progress', async () => {
    const progress = vi.fn()
    const pending = new GMRequest().get('https://example.com/video.mp4', {
      maxResponseBytes: 10,
      onProgress: progress,
    })
    const options = mocks.request.mock.calls[0]![0]

    options.onprogress({
      lengthComputable: true,
      loaded: 4,
      readyState: 3,
      responseHeaders: 'content-length: 10',
      status: 206,
      statusText: 'Partial Content',
      total: 10,
      totalSize: 10,
    })

    expect(progress).toHaveBeenCalledWith({
      lengthComputable: true,
      loaded: 4,
      total: 10,
    })
    mocks.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
