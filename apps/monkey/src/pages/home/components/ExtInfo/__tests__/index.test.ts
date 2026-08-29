// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import ExtInfo from '../index.vue'

const mocks = vi.hoisted(() => ({
  loadInfo: vi.fn(async () => ({
    source: 'JavLibrary',
    baseUrl: 'https://www.javlibrary.com/',
    searchUrl: 'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=ABP-123',
    detailUrl: 'https://www.javlibrary.com/cn/example.html',
    avNumber: 'ABP-123',
    title: '测试影片',
    cover: {
      url: 'https://images.example/abp-123.jpg',
      referer: 'https://www.javlibrary.com/cn/example.html',
    },
    actors: [],
  })),
  coverLoader: vi.fn(() => ({
    key: 'cover-loader',
    load: vi.fn(),
  })),
}))

vi.mock('@/utils/jav', () => ({
  createJavInfoSources: vi.fn(() => []),
}))

vi.mock('@/utils/jav/loadInfo', () => ({
  loadJavInfo: mocks.loadInfo,
}))

vi.mock('@/utils/imageLoader', () => ({
  createFanzaCoverLoader: mocks.coverLoader,
}))

const apps: ReturnType<typeof createApp>[] = []

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('extInfo', () => {
  it('drive 详情只渲染文字，不创建隐藏封面加载器', async () => {
    /*
     * ================================================================================
     * 步骤1：挂载管理器紧凑详情
     * ================================================================================
     * 目标：保留番号资料，同时避免为不可见封面分配请求、Blob 和缓存。
     * 数据源：一条带远程封面的 JavLibrary 资料。
     * 操作：
     * 1) 使用 drive 变体挂载详情
     * 2) 核对标题可见且图片与封面加载器均未创建
     */
    console.info('[unit] 开始验证 drive 详情隐藏封面资源边界')

    /** 1.1 挂载紧凑详情并等待异步资料落入视图。 */
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(ExtInfo, { avNumber: 'ABP-123', variant: 'drive' })
    app.mount(root)
    apps.push(app)
    await vi.waitFor(() => expect(root.textContent).toContain('测试影片'))
    await nextTick()

    /** 1.2 详情文字保留，但隐藏封面不进入 Image 或 FANZA 加载链。 */
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('[data-ui-image]')).toBeNull()
    expect(mocks.coverLoader).not.toHaveBeenCalled()

    console.info('[unit] drive 详情隐藏封面资源边界验证完成')
  })
})
