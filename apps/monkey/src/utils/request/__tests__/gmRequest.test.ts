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
})
