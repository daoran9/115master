// @vitest-environment jsdom

import type { GMImageCandidate } from '../gm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JAV_SOURCE } from '@/utils/jav/jav'
import { createFanzaCoverLoader, isProductForAvNumber } from '../fanza'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  createLoader: vi.fn(),
  loads: [] as GMImageCandidate[][],
  available: new Set<string>(),
}))

vi.mock('@/utils/request/gmRequest', () => ({
  GMRequest: class {
    request = mocks.request
  },
}))

vi.mock('@/utils/cache/javCache', () => ({
  javCache: {
    get: mocks.cacheGet,
    set: mocks.cacheSet,
  },
}))

vi.mock('../gm', () => ({
  createGMImageFallbackLoader: mocks.createLoader,
}))

function graphql(contents: unknown[]) {
  return new Response(JSON.stringify({
    data: {
      legacySearchPPV: {
        result: { contents },
      },
    },
  }), { status: 200 })
}

function loader() {
  return createFanzaCoverLoader({
    avNumber: 'HMDNV-767',
    title: '官方完整标题',
    fallbacks: [{ url: 'https://javbus.example/fallback.jpg' }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loads.length = 0
  mocks.available.clear()
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue(undefined)
  mocks.createLoader.mockImplementation((candidates: GMImageCandidate[]) => ({
    key: JSON.stringify(candidates),
    async load(_url: string, signal: AbortSignal) {
      if (signal.aborted)
        throw signal.reason ?? new DOMException('请求已取消', 'AbortError')
      mocks.loads.push(candidates)
      const candidate = candidates.find(item => mocks.available.has(item.url))
      if (!candidate)
        throw new Error('图片不可用')
      return { src: candidate.url }
    },
  }))
})

describe('fanza cover loader', () => {
  it('uses a valid mono cover without querying GraphQL', async () => {
    const mono = 'https://pics.dmm.co.jp/mono/movie/hmdnv767/hmdnv767pl.jpg'
    mocks.available.add(mono)

    const result = await loader().load('fallback', new AbortController().signal)

    expect(result.src).toBe(mono)
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.loads[0]).toEqual([expect.objectContaining({
      url: mono,
      minBytes: 3000,
      minAspectRatio: 1.1,
    })])
  })

  it('queries by title after the av number has no exact result', async () => {
    const digital = 'https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1472hmdnv00767/h_1472hmdnv00767pl.jpg'
    mocks.available.add(digital)
    mocks.request
      .mockResolvedValueOnce(graphql([]))
      .mockResolvedValueOnce(graphql([{
        id: 'h_1472hmdnv00767',
        title: 'FANZA 标题',
        packageImage: { largeUrl: digital },
      }]))

    const result = await loader().load('fallback', new AbortController().signal)

    expect(result.src).toBe(digital)
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(JSON.parse(mocks.request.mock.calls[0]![1].body).variables.word).toBe('HMDNV-767')
    expect(JSON.parse(mocks.request.mock.calls[1]![1].body).variables.word).toBe('官方完整标题')
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      'FANZA:HMDNV767',
      expect.objectContaining({ source: JAV_SOURCE.FANZA, avNumber: 'HMDNV-767' }),
    )
  })

  it('rejects a similar product id and keeps the existing fallback', async () => {
    mocks.available.add('https://javbus.example/fallback.jpg')
    mocks.request.mockResolvedValue(graphql([{
      id: 'h_1472hmdnv001767',
      title: '相似番号',
      packageImage: { largeUrl: 'https://images.example/similar.jpg' },
    }]))

    const result = await loader().load('fallback', new AbortController().signal)

    expect(result.src).toBe('https://javbus.example/fallback.jpg')
    expect(mocks.cacheSet).not.toHaveBeenCalled()
    expect(mocks.loads.flat().map(candidate => candidate.url))
      .not
      .toContain('https://images.example/similar.jpg')
  })

  it('falls back to the existing source when FANZA fails', async () => {
    mocks.available.add('https://javbus.example/fallback.jpg')
    mocks.request.mockRejectedValue(new Error('network failed'))

    const result = await loader().load('fallback', new AbortController().signal)

    expect(result.src).toBe('https://javbus.example/fallback.jpg')
  })

  it('prefers an existing horizontal cover over a FANZA digital image', async () => {
    const digital = 'https://awsimgsrc.dmm.co.jp/digital.jpg'
    const fallback = 'https://javbus.example/fallback.jpg'
    mocks.available.add(digital)
    mocks.available.add(fallback)
    mocks.request.mockResolvedValue(graphql([{
      id: 'h_1472hmdnv00767',
      title: 'FANZA 标题',
      packageImage: { largeUrl: digital },
    }]))

    const result = await loader().load('fallback', new AbortController().signal)

    expect(result.src).toBe(fallback)
    expect(mocks.loads.some(candidates => candidates.some(candidate => (
      candidate.url === fallback && candidate.minAspectRatio === 1.1
    )))).toBe(true)
    expect(mocks.loads.flat().map(candidate => candidate.url)).not.toContain(digital)
  })

  it('aborts the active GraphQL request without starting a fallback', async () => {
    let requestSignal: AbortSignal | undefined
    mocks.request.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
      requestSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(options.signal.reason ?? new DOMException('请求已取消', 'AbortError'))
        }, { once: true })
      })
    })
    const controller = new AbortController()
    const result = loader().load('fallback', controller.signal)
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal?.aborted).toBe(true)
    expect(mocks.loads).toHaveLength(1)
  })

  it('uses a cached exact product without querying GraphQL', async () => {
    const digital = 'https://awsimgsrc.dmm.co.jp/cached.jpg'
    mocks.available.add(digital)
    mocks.cacheGet.mockResolvedValue({
      value: {
        source: JAV_SOURCE.FANZA,
        baseUrl: 'https://video.dmm.co.jp/',
        detailUrl: 'https://video.dmm.co.jp/av/content/?id=h_1472hmdnv00767',
        searchUrl: 'https://video.dmm.co.jp/list/',
        avNumber: 'HMDNV-767',
        title: '缓存标题',
        cover: { url: digital },
      },
    })

    const result = await loader().load('fallback', new AbortController().signal)

    expect(result.src).toBe(digital)
    expect(mocks.request).not.toHaveBeenCalled()
  })
})

describe('isProductForAvNumber', () => {
  it('matches zero-padded exact suffixes only', () => {
    expect(isProductForAvNumber('HMDNV-767', 'h_1472hmdnv00767')).toBe(true)
    expect(isProductForAvNumber('HMDNV-767', 'h_1472hmdnv001767')).toBe(false)
    expect(isProductForAvNumber('HMDNV-767', 'hmdnv00767_sample')).toBe(false)
  })
})
