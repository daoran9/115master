// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGMImageFallbackLoader, createGMImageLoader } from '../gm'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheRemove: vi.fn(),
  compress: vi.fn(async (blob: Blob) => blob),
}))

vi.mock('@/utils/request/gmRequest', () => ({
  GMRequest: class {
    get = mocks.get
  },
}))

vi.mock('@/utils/cache/imageCache', () => ({
  imageCache: {
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    remove: mocks.cacheRemove,
  },
}))

vi.mock('@115master/utils', () => ({
  image: { compress: mocks.compress },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue(undefined)
  mocks.cacheRemove.mockResolvedValue(undefined)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:loaded'),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createGMImageLoader', () => {
  it('preserves the response MIME type and returns a disposable object URL', async () => {
    const blob = new Blob(['image'], { type: 'image/png' })
    mocks.get.mockResolvedValue({ ok: true, status: 200, blob: async () => blob })
    const loader = createGMImageLoader({
      referer: 'https://ref',
      cache: false,
      transform: false,
      cookiePartition: { topLevelSite: 'https://ref' },
    })

    const result = await loader.load('https://image', new AbortController().signal)

    expect(mocks.get).toHaveBeenCalledWith('https://image', expect.objectContaining({
      headers: { Referer: 'https://ref' },
      responseType: 'blob',
      timeout: 5000,
      cookiePartition: { topLevelSite: 'https://ref' },
    }))
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }))
    result.dispose?.()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:loaded')
  })

  it('rejects unsuccessful responses before compression', async () => {
    mocks.get.mockResolvedValue({ ok: false, status: 404 })
    const loader = createGMImageLoader({ referer: 'https://ref' })

    await expect(loader.load('https://image', new AbortController().signal)).rejects.toThrow('404')
    expect(mocks.compress).not.toHaveBeenCalled()
  })

  it('separates cache entries by referer, cookie partition and transform version', () => {
    const first = createGMImageLoader({ referer: 'https://first' })
    const second = createGMImageLoader({ referer: 'https://second' })
    const original = createGMImageLoader({ referer: 'https://first', transform: false })
    const partitioned = createGMImageLoader({
      referer: 'https://first',
      cookiePartition: { topLevelSite: 'https://first' },
    })

    expect(new Set([first.key, second.key, original.key, partitioned.key])).toHaveLength(4)
  })

  it('refetches expired cache entries', async () => {
    mocks.cacheGet.mockResolvedValue({
      value: new Blob(['stale'], { type: 'image/webp' }),
      createdAt: 0,
      updatedAt: 0,
    })
    mocks.get.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fresh'], { type: 'image/png' }),
    })
    const loader = createGMImageLoader({ referer: 'https://ref', maxAge: 1 })

    await loader.load('https://image', new AbortController().signal)

    expect(mocks.cacheRemove).toHaveBeenCalledOnce()
    expect(mocks.get).toHaveBeenCalledOnce()
    expect(mocks.cacheSet).toHaveBeenCalledOnce()
  })

  it('passes cancellation to GMRequest', async () => {
    let requestSignal: AbortSignal | undefined
    mocks.get.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
      requestSignal = options.signal
      return new Promise<never>(() => {})
    })
    const controller = new AbortController()
    const loader = createGMImageLoader({ referer: 'https://ref', cache: false })

    const result = loader.load('https://image', controller.signal)
    await Promise.resolve()
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal?.aborted).toBe(true)
  })

  it('falls back to the next source when the primary cover fails', async () => {
    /**
     * ================================================================================
     * 步骤1：验证跨来源封面回退
     * ================================================================================
     * 目标：JavBus 图片失效时继续加载 MissAV 封面。
     * 数据源：一个 404 响应和一个有效图片响应。
     * 操作：
     * 1) 依次返回失败与成功结果
     * 2) 核对 URL 和 Referer 均按候选顺序使用
     */
    const blob = new Blob(['fallback'], { type: 'image/jpeg' })
    mocks.get
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob })
    const loader = createGMImageFallbackLoader([
      {
        url: 'https://javbus.example/cover.jpg',
        referer: 'https://javbus.example/DANDY-423',
        cookiePartition: { topLevelSite: 'https://javbus.example' },
      },
      { url: 'https://missav.example/cover.jpg', referer: 'https://missav.example/DANDY-423' },
    ], { cache: false, transform: false })

    const result = await loader.load('https://javbus.example/cover.jpg', new AbortController().signal)

    expect(result.src).toBe('blob:loaded')
    expect(mocks.get).toHaveBeenNthCalledWith(1, 'https://javbus.example/cover.jpg', expect.objectContaining({
      headers: { Referer: 'https://javbus.example/DANDY-423' },
      cookiePartition: { topLevelSite: 'https://javbus.example' },
    }))
    expect(mocks.get).toHaveBeenNthCalledWith(2, 'https://missav.example/cover.jpg', expect.objectContaining({
      headers: { Referer: 'https://missav.example/DANDY-423' },
    }))
  })

  it('times out a stalled GM promise and continues with the next candidate', async () => {
    vi.useFakeTimers()
    let stalledSignal: AbortSignal | undefined
    const blob = new Blob(['fallback'], { type: 'image/jpeg' })
    mocks.get
      .mockImplementationOnce((_url: string, options: { signal: AbortSignal }) => {
        stalledSignal = options.signal
        return new Promise<never>(() => {})
      })
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob })
    const loader = createGMImageFallbackLoader([
      { url: 'https://stalled.example/cover.jpg' },
      { url: 'https://fallback.example/cover.jpg' },
    ], { cache: false, timeoutMs: 100, transform: false })

    const resultPromise = loader.load('https://stalled.example/cover.jpg', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(100)

    await expect(resultPromise).resolves.toMatchObject({ src: 'blob:loaded' })
    expect(stalledSignal?.aborted).toBe(true)
    expect(mocks.get).toHaveBeenNthCalledWith(2, 'https://fallback.example/cover.jpg', expect.any(Object))
  })
})
