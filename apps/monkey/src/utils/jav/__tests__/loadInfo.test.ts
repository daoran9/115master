import type { JavInfo } from '../jav'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { cache, testLogger } = vi.hoisted(() => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
  },
  testLogger: (() => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      sub: undefined as unknown as ReturnType<typeof vi.fn>,
    }
    logger.sub = vi.fn(() => logger)
    return logger
  })(),
}))

vi.mock('@/utils/logger', () => ({
  appLogger: {
    sub: () => testLogger,
  },
}))
vi.mock('@/utils/request/gmRequest', () => ({
  GMRequest: class {},
}))
vi.mock('@/utils/cache/javCache', () => ({
  javCache: cache,
}))

const { JAV_SOURCE } = await import('../jav')
const { loadJavInfo } = await import('../loadInfo')

function info(
  source: JavInfo['source'],
  avNumber: string,
  fields: Partial<JavInfo> = {},
): JavInfo {
  return {
    source,
    avNumber,
    baseUrl: `https://${source}.example`,
    detailUrl: `https://${source}.example/${avNumber}`,
    searchUrl: `https://${source}.example/search/${avNumber}`,
    title: `${source} ${avNumber}`,
    date: 1_735_776_000_000,
    duration: 120,
    actors: [{ name: `${source} actor` }],
    category: [{ name: `${source} category` }],
    cover: { url: `https://${source}.example/${avNumber}.jpg` },
    ...fields,
  }
}

function deferred<T>() {
  let resolve = undefined as unknown as (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function source(
  sourceName: JavInfo['source'],
  cacheValue?: JavInfo,
  networkValue?: Promise<JavInfo | undefined> | JavInfo,
) {
  return {
    source: sourceName,
    getInfoByCache: vi.fn(async () => cacheValue),
    getInfo: vi.fn(async () => await networkValue),
  }
}

describe('loadJavInfo', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    cache.get.mockResolvedValue(undefined)
  })

  it('并行读取缓存后仍按来源优先级选取', async () => {
    /*
     * ================================================================================
     * 步骤1：验证缓存优先级
     * ================================================================================
     * 目标：JavLibrary 缓存优先于同时命中的 JavDB。
     * 数据源：四个模拟资料源。
     * 操作：
     * 1) 同时返回多个缓存结果
     * 2) 核对结果与联网调用
     */
    testLogger.info('开始验证番号资料缓存优先级')
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY, info(JAV_SOURCE.JAVLIBRARY, 'CACHE-001')),
      source(JAV_SOURCE.JAVBUS),
      source(JAV_SOURCE.JAVDB, info(JAV_SOURCE.JAVDB, 'CACHE-001')),
      source(JAV_SOURCE.MISSAV),
    ]

    const result = await loadJavInfo('CACHE-001', sources, { hedgeDelay: 10 })

    expect(result?.source).toBe(JAV_SOURCE.JAVLIBRARY)
    expect(sources.every(item => item.getInfoByCache.mock.calls.length === 1)).toBe(true)
    expect(sources.every(item => item.getInfo.mock.calls.length === 0)).toBe(true)
    testLogger.info('番号资料缓存优先级验证完成')
  })

  it('用后备来源补齐 JavLibrary 缺失字段后缓存完整详情', async () => {
    testLogger.info('开始验证 JavLibrary 详情补全缓存')
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY, info(JAV_SOURCE.JAVLIBRARY, 'MERGE-001', {
        actors: [{ name: 'JavLibrary 演员' }],
        category: undefined,
        cover: undefined,
      })),
      source(JAV_SOURCE.JAVBUS, info(JAV_SOURCE.JAVBUS, 'MERGE-001', {
        category: [{ name: '后备分类' }],
      })),
      source(JAV_SOURCE.JAVDB),
      source(JAV_SOURCE.MISSAV),
    ]

    const result = await loadJavInfo('MERGE-001', sources)

    expect(result).toMatchObject({
      source: JAV_SOURCE.JAVLIBRARY,
      actors: [{ name: 'JavLibrary 演员' }],
      category: [{ name: '后备分类' }],
      cover: { url: 'https://JavBus.example/MERGE-001.jpg' },
    })
    expect(cache.set).toHaveBeenCalledWith('Fusion:MERGE-001', result)
    testLogger.info('JavLibrary 详情补全缓存验证完成')
  })

  it('已显示的后备来源缓存不重复联网', async () => {
    /*
     * ================================================================================
     * 步骤1：验证后备来源热缓存
     * ================================================================================
     * 目标：上次采用 JavBus 后，刷新页面直接恢复已显示详情。
     * 数据源：JavLibrary 空缓存和可展示的 JavBus 缓存。
     * 操作：
     * 1) 并行读取全部来源缓存
     * 2) 核对融合缓存写入且全部来源保持零联网
     */
    testLogger.info('开始验证后备来源热缓存')
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY, undefined, info(JAV_SOURCE.JAVLIBRARY, 'FIRST-001')),
      source(JAV_SOURCE.JAVBUS, info(JAV_SOURCE.JAVBUS, 'FIRST-001')),
      source(JAV_SOURCE.JAVDB),
      source(JAV_SOURCE.MISSAV),
    ]

    const result = await loadJavInfo('FIRST-001', sources)

    expect(result?.source).toBe(JAV_SOURCE.JAVBUS)
    expect(sources.every(item => item.getInfo.mock.calls.length === 0)).toBe(true)
    expect(cache.set).toHaveBeenCalledWith('Fusion:FIRST-001', result)
    testLogger.info('后备来源热缓存验证完成')
  })

  it('完整融合缓存不因主来源暂时不可用而重复联网', async () => {
    /*
     * ================================================================================
     * 步骤1：验证融合缓存即时命中
     * ================================================================================
     * 目标：刷新页面时立即显示上次完整详情，不再等待首选来源超时。
     * 数据源：已完成的 JavBus 融合缓存和四个空来源缓存。
     * 操作：
     * 1) 返回番号一致的完整融合缓存
     * 2) 核对不再发起任何来源网络请求
     */
    testLogger.info('开始验证完整融合缓存即时命中')
    cache.get.mockResolvedValueOnce({
      value: info(JAV_SOURCE.JAVBUS, 'MERGED-FAST-001'),
    })
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY),
      source(JAV_SOURCE.JAVBUS),
      source(JAV_SOURCE.JAVDB),
      source(JAV_SOURCE.MISSAV),
    ]

    const result = await loadJavInfo('MERGED-FAST-001', sources)

    expect(result?.source).toBe(JAV_SOURCE.JAVBUS)
    expect(sources.every(item => item.getInfo.mock.calls.length === 0)).toBe(true)
    testLogger.info('完整融合缓存即时命中验证完成')
  })

  it('缺少演员和导演的可展示详情仍作为融合缓存复用', async () => {
    /*
     * ================================================================================
     * 步骤1：验证最小可展示缓存
     * ================================================================================
     * 目标：来源缺少演员、导演等附加字段时，标题和封面仍可在刷新后立即恢复。
     * 数据源：只包含精确番号、标题和封面的 JavDB 融合缓存。
     * 操作：
     * 1) 返回不含日期、演员、导演和分类的融合缓存
     * 2) 核对详情直接返回且全部来源保持零联网
     */
    testLogger.info('开始验证最小可展示融合缓存')
    cache.get.mockResolvedValueOnce({
      value: info(JAV_SOURCE.JAVDB, 'MINIMAL-001', {
        date: undefined,
        duration: undefined,
        actors: undefined,
        director: undefined,
        category: undefined,
        studio: undefined,
        series: undefined,
      }),
    })
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY),
      source(JAV_SOURCE.JAVBUS),
      source(JAV_SOURCE.JAVDB),
      source(JAV_SOURCE.MISSAV),
    ]

    const result = await loadJavInfo('MINIMAL-001', sources)

    expect(result).toMatchObject({
      source: JAV_SOURCE.JAVDB,
      avNumber: 'MINIMAL-001',
      title: 'JavDB MINIMAL-001',
      cover: { url: 'https://JavDB.example/MINIMAL-001.jpg' },
    })
    expect(sources.every(item => item.getInfo.mock.calls.length === 0)).toBe(true)
    testLogger.info('最小可展示融合缓存验证完成')
  })

  it('慢源等待期间启动后备封面来源但不改变字段优先级', async () => {
    /*
     * ================================================================================
     * 步骤1：验证重叠回退
     * ================================================================================
     * 目标：JavLibrary 未结束时允许 JavBus 预请求，并继续启动后备封面来源。
     * 数据源：延迟完成的 JavLibrary 和立即命中的 JavBus。
     * 操作：
     * 1) 推进预请求延迟
     * 2) 核对字段仍采用 JavBus，后两源也得到封面回退机会
     */
    testLogger.info('开始验证番号资料重叠回退')
    vi.useFakeTimers()
    const javBusResult = deferred<JavInfo | undefined>()
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY, undefined, javBusResult.promise),
      source(JAV_SOURCE.JAVBUS, undefined, info(JAV_SOURCE.JAVBUS, 'SLOW-001')),
      source(JAV_SOURCE.JAVDB),
      source(JAV_SOURCE.MISSAV),
    ]

    const resultPromise = loadJavInfo('SLOW-001', sources, { hedgeDelay: 100 })
    await vi.advanceTimersByTimeAsync(100)

    expect(sources[0].getInfo).toHaveBeenCalledTimes(1)
    expect(sources[1].getInfo).toHaveBeenCalledTimes(1)
    expect(sources[2].getInfo).not.toHaveBeenCalled()

    javBusResult.resolve(undefined)
    await vi.advanceTimersByTimeAsync(201)
    const result = await resultPromise
    expect(result?.source).toBe(JAV_SOURCE.JAVBUS)
    expect(sources[2].getInfo).toHaveBeenCalledOnce()
    expect(sources[3].getInfo).toHaveBeenCalledOnce()
    testLogger.info('番号资料重叠回退验证完成')
  })

  it('保留低优先级来源封面供图片失败时回退', async () => {
    /*
     * ================================================================================
     * 步骤1：验证融合详情封面候选
     * ================================================================================
     * 目标：JavBus 字段保持优先，同时保存 MissAV 替代封面。
     * 数据源：无结果的 JavLibrary、完整 JavBus 和封面型 MissAV。
     * 操作：
     * 1) 同时返回主详情和低优先级封面
     * 2) 核对主来源及后备封面顺序
     */
    testLogger.info('开始验证番号详情后备封面')
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY),
      source(JAV_SOURCE.JAVBUS, undefined, info(JAV_SOURCE.JAVBUS, 'COVER-001', {
        cover: { url: 'https://javbus.example/cover.jpg', referer: 'https://javbus.example/COVER-001' },
        coverSingle: undefined,
      })),
      source(JAV_SOURCE.JAVDB),
      source(JAV_SOURCE.MISSAV, undefined, info(JAV_SOURCE.MISSAV, 'COVER-001', {
        cover: { url: 'https://missav.example/cover.jpg', referer: 'https://missav.example/COVER-001' },
        actors: undefined,
        category: undefined,
        date: undefined,
        duration: undefined,
      })),
    ]

    const result = await loadJavInfo('COVER-001', sources, { hedgeDelay: 0 })

    expect(result?.source).toBe(JAV_SOURCE.JAVBUS)
    expect(result?.cover).toEqual({
      url: 'https://javbus.example/cover.jpg',
      referer: 'https://javbus.example/COVER-001',
    })
    expect(result?.coverFallbacks).toContainEqual({
      url: 'https://missav.example/cover.jpg',
      referer: 'https://missav.example/COVER-001',
    })
    testLogger.info('番号详情后备封面验证完成')
  })

  it('javLibrary 超过等待期限时采用已经完成的 JavBus', async () => {
    /*
     * ================================================================================
     * 步骤1：验证首选来源超时回退
     * ================================================================================
     * 目标：JavLibrary 工作队列阻塞时，页面及时显示已返回的 JavBus 详情。
     * 数据源：永不完成的 JavLibrary 和立即完成的 JavBus。
     * 操作：
     * 1) 推进 JavLibrary 等待期限
     * 2) 核对采用 JavBus 并取消首选来源任务
     */
    testLogger.info('开始验证 JavLibrary 超时回退')
    vi.useFakeTimers()
    const javLibraryResult = deferred<JavInfo | undefined>()
    const cancelInfoRequest = vi.fn()
    const javLibrary = {
      ...source(JAV_SOURCE.JAVLIBRARY, undefined, javLibraryResult.promise),
      cancelInfoRequest,
    }
    const sources = [
      javLibrary,
      source(JAV_SOURCE.JAVBUS, undefined, info(JAV_SOURCE.JAVBUS, 'TIMEOUT-001')),
      source(JAV_SOURCE.JAVDB),
    ]

    const resultPromise = loadJavInfo('TIMEOUT-001', sources, {
      hedgeDelay: 10,
      sourceWaitTimeout: 100,
    })
    await vi.advanceTimersByTimeAsync(100)

    await expect(resultPromise).resolves.toMatchObject({
      source: JAV_SOURCE.JAVBUS,
      avNumber: 'TIMEOUT-001',
    })
    expect(cancelInfoRequest).toHaveBeenCalledWith('TIMEOUT-001')
    testLogger.info('JavLibrary 超时回退验证完成')
  })

  it('javLibrary 在等待期限内返回时仍保持第一优先级', async () => {
    /*
     * ================================================================================
     * 步骤1：验证首选来源期限内命中
     * ================================================================================
     * 目标：性能回退不能改变 JavLibrary 第一来源规则。
     * 数据源：期限内返回的 JavLibrary 和更早返回的 JavBus。
     * 操作：
     * 1) 先让 JavBus 完成，再完成 JavLibrary
     * 2) 核对最终来源仍为 JavLibrary
     */
    testLogger.info('开始验证 JavLibrary 期限内优先级')
    vi.useFakeTimers()
    const javLibraryResult = deferred<JavInfo | undefined>()
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY, undefined, javLibraryResult.promise),
      source(JAV_SOURCE.JAVBUS, undefined, info(JAV_SOURCE.JAVBUS, 'PRIORITY-001')),
    ]

    const resultPromise = loadJavInfo('PRIORITY-001', sources, {
      hedgeDelay: 10,
      sourceWaitTimeout: 100,
    })
    await vi.advanceTimersByTimeAsync(50)
    javLibraryResult.resolve(info(JAV_SOURCE.JAVLIBRARY, 'PRIORITY-001'))

    await expect(resultPromise).resolves.toMatchObject({
      source: JAV_SOURCE.JAVLIBRARY,
      avNumber: 'PRIORITY-001',
    })
    testLogger.info('JavLibrary 期限内优先级验证完成')
  })

  it('合并同一番号的并发加载', async () => {
    /*
     * ================================================================================
     * 步骤1：验证请求合并
     * ================================================================================
     * 目标：重复番号只触发一次资料源请求。
     * 数据源：两个同时发起的相同番号查询。
     * 操作：
     * 1) 同时请求相同番号
     * 2) 核对 Promise 和来源调用次数
     */
    testLogger.info('开始验证相同番号请求合并')
    const javBusResult = deferred<JavInfo | undefined>()
    const sources = [source(JAV_SOURCE.JAVBUS, undefined, javBusResult.promise)]

    const first = loadJavInfo('SAME-001', sources)
    const second = loadJavInfo('same-001', sources)
    expect(first).toBe(second)

    javBusResult.resolve(info(JAV_SOURCE.JAVBUS, 'SAME-001'))
    await expect(first).resolves.toMatchObject({ source: JAV_SOURCE.JAVBUS })
    expect(sources[0].getInfo).toHaveBeenCalledTimes(1)
    testLogger.info('相同番号请求合并验证完成')
  })

  it('冷缓存联网任务最多同时加载三个番号', async () => {
    /*
     * ================================================================================
     * 步骤1：验证番号级联网并发限制
     * ================================================================================
     * 目标：首屏多个详情不能无限制地同时向全部资料源发起请求。
     * 数据源：四个不同番号和四个受控网络响应。
     * 操作：
     * 1) 同时启动四个冷缓存番号
     * 2) 释放一个槽后核对第四个番号才开始联网
     */
    testLogger.info('开始验证番号资料联网并发限制')
    const networkResults = Array.from(
      { length: 4 },
      () => deferred<JavInfo | undefined>(),
    )
    const sources = networkResults.map(networkResult =>
      source(JAV_SOURCE.JAVBUS, undefined, networkResult.promise),
    )

    const loads = sources.map((item, index) =>
      loadJavInfo(`QUEUE-${index + 1}`, [item], { hedgeDelay: 0 }),
    )
    await vi.waitFor(() => {
      expect(sources[0]!.getInfo).toHaveBeenCalledOnce()
      expect(sources[1]!.getInfo).toHaveBeenCalledOnce()
      expect(sources[2]!.getInfo).toHaveBeenCalledOnce()
    })
    expect(sources[3]!.getInfo).not.toHaveBeenCalled()

    networkResults[0]!.resolve(info(JAV_SOURCE.JAVBUS, 'QUEUE-1'))
    await vi.waitFor(() => expect(sources[3]!.getInfo).toHaveBeenCalledOnce())
    networkResults[1]!.resolve(info(JAV_SOURCE.JAVBUS, 'QUEUE-2'))
    networkResults[2]!.resolve(info(JAV_SOURCE.JAVBUS, 'QUEUE-3'))
    networkResults[3]!.resolve(info(JAV_SOURCE.JAVBUS, 'QUEUE-4'))

    await expect(Promise.all(loads)).resolves.toHaveLength(4)
    testLogger.info('番号资料联网并发限制验证完成')
  })

  it('全部来源缓慢时分段启动所有后备请求', async () => {
    /*
     * ================================================================================
     * 步骤1：验证完整重叠回退
     * ================================================================================
     * 目标：首选源长期未完成时，其余三个来源依次提前启动。
     * 数据源：四个受控的延迟请求。
     * 操作：
     * 1) 推进三个分段等待周期
     * 2) 核对全部来源启动且最终无结果
     */
    testLogger.info('开始验证完整番号资料重叠回退')
    vi.useFakeTimers()
    const results = Array.from({ length: 4 }, () => deferred<JavInfo | undefined>())
    const sources = [
      source(JAV_SOURCE.JAVBUS, undefined, results[0]!.promise),
      source(JAV_SOURCE.JAVLIBRARY, undefined, results[1]!.promise),
      source(JAV_SOURCE.JAVDB, undefined, results[2]!.promise),
      source(JAV_SOURCE.MISSAV, undefined, results[3]!.promise),
    ]

    const resultPromise = loadJavInfo('SLOW-ALL-001', sources, { hedgeDelay: 100 })
    await vi.advanceTimersByTimeAsync(301)
    expect(sources.every(item => item.getInfo.mock.calls.length === 1)).toBe(true)

    results.forEach(result => result.resolve(undefined))
    await expect(resultPromise).resolves.toBeNull()
    testLogger.info('完整番号资料重叠回退验证完成')
  })

  it('忽略番号不一致的融合缓存', async () => {
    /*
     * ================================================================================
     * 步骤1：验证融合缓存番号门禁
     * ================================================================================
     * 目标：旧缓存即使字段完整，也不能显示到另一个相似番号上。
     * 数据源：错误 Fusion 缓存和精确网络结果。
     * 操作：
     * 1) 返回来源相同但番号不同的融合缓存
     * 2) 核对继续联网并采用精确结果
     */
    testLogger.info('开始验证融合缓存番号门禁')
    cache.get.mockResolvedValueOnce({
      value: info(JAV_SOURCE.JAVLIBRARY, 'TARGET-001-C'),
    })
    const sources = [
      source(
        JAV_SOURCE.JAVLIBRARY,
        undefined,
        info(JAV_SOURCE.JAVLIBRARY, 'TARGET-001'),
      ),
    ]

    const result = await loadJavInfo('TARGET-001', sources, { hedgeDelay: 0 })

    expect(sources[0].getInfo).toHaveBeenCalledOnce()
    expect(result?.avNumber).toBe('TARGET-001')
    testLogger.info('融合缓存番号门禁验证完成')
  })

  it('错误单源缓存不参与字段融合', async () => {
    /*
     * ================================================================================
     * 步骤1：验证单源缓存隔离
     * ================================================================================
     * 目标：相似番号缓存中的演员和封面不能补到当前番号。
     * 数据源：高优先级错误缓存和低优先级精确缓存。
     * 操作：
     * 1) 给错误缓存加入独有演员字段
     * 2) 核对结果只包含精确缓存字段
     */
    testLogger.info('开始验证错误单源缓存隔离')
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY, info(JAV_SOURCE.JAVLIBRARY, 'CACHE-010', {
        actors: [{ name: '错误演员' }],
      })),
      source(JAV_SOURCE.JAVBUS, info(JAV_SOURCE.JAVBUS, 'CACHE-001', {
        actors: undefined,
        director: [{ name: '精确导演' }],
      })),
    ]

    const result = await loadJavInfo('CACHE-001', sources, { hedgeDelay: 0 })

    expect(result?.source).toBe(JAV_SOURCE.JAVBUS)
    expect(result?.actors).toBeUndefined()
    expect(result?.director).toEqual([{ name: '精确导演' }])
    testLogger.info('错误单源缓存隔离验证完成')
  })

  it('高优先级网络结果番号错误时继续回退', async () => {
    /*
     * ================================================================================
     * 步骤1：验证网络结果番号门禁
     * ================================================================================
     * 目标：首选源返回相似番号时继续使用后续精确来源。
     * 数据源：错误 JavLibrary 响应和精确 JavBus 响应。
     * 操作：
     * 1) 两个来源同时返回完整资料
     * 2) 核对相似番号被拒绝且精确来源生效
     */
    testLogger.info('开始验证网络结果番号门禁')
    const sources = [
      source(
        JAV_SOURCE.JAVLIBRARY,
        undefined,
        info(JAV_SOURCE.JAVLIBRARY, 'NETWORK-001-C'),
      ),
      source(
        JAV_SOURCE.JAVBUS,
        undefined,
        info(JAV_SOURCE.JAVBUS, 'NETWORK-001'),
      ),
    ]

    const result = await loadJavInfo('NETWORK-001', sources, { hedgeDelay: 0 })

    expect(result?.source).toBe(JAV_SOURCE.JAVBUS)
    expect(result?.avNumber).toBe('NETWORK-001')
    testLogger.info('网络结果番号门禁验证完成')
  })

  it('大小写和分隔符差异仍视为同一番号', async () => {
    /*
     * ================================================================================
     * 步骤1：验证番号标准化边界
     * ================================================================================
     * 目标：只放宽大小写和标点，不改变字母或数字本身。
     * 数据源：下划线缓存和连字符查询。
     * 操作：
     * 1) 返回标点形式不同的精确缓存
     * 2) 核对缓存直接命中
     */
    testLogger.info('开始验证番号标准化边界')
    const sources = [
      source(JAV_SOURCE.JAVLIBRARY, info(JAV_SOURCE.JAVLIBRARY, 'same_001')),
    ]

    const result = await loadJavInfo('SAME-001', sources, { hedgeDelay: 0 })

    expect(result?.avNumber).toBe('same_001')
    expect(sources[0].getInfo).not.toHaveBeenCalled()
    testLogger.info('番号标准化边界验证完成')
  })
})
