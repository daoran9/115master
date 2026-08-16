import type { JavInfo } from '../jav'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { cache, testLogger } = vi.hoisted(() => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
  },
  testLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
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

const {
  isSameAvNumber,
  Jav,
  JAV_SOURCE,
} = await import('../jav')

function createInfo(avNumber: string, fields: Partial<JavInfo> = {}): JavInfo {
  return {
    source: JAV_SOURCE.JAVBUS,
    baseUrl: 'https://example.com',
    detailUrl: `https://example.com/${avNumber}`,
    searchUrl: `https://example.com/search/${avNumber}`,
    avNumber,
    title: `标题 ${avNumber}`,
    cover: { url: `https://example.com/${avNumber}.jpg` },
    ...fields,
  }
}

class TestJav extends Jav {
  source = JAV_SOURCE.JAVBUS
  baseUrl = 'https://example.com'
  detailUrl = ''
  searchUrl = ''
  networkInfo?: JavInfo

  async getInfoByAvNumber(): Promise<JavInfo | undefined> {
    return this.networkInfo
  }

  parseAvNumber() { return undefined }
  parseTitle() { return undefined }
  parseDate() { return undefined }
  parseDuration() { return undefined }
  parseDirector() { return undefined }
  parseActor() { return undefined }
  parseStudio() { return undefined }
  parsePublisher() { return undefined }
  parseCover() { return undefined }
  parseCoverSingle() { return undefined }
  parsePreview() { return undefined }
  parseSeries() { return undefined }
  parseCategory() { return undefined }
}

describe('jav 番号验真与缓存', () => {
  afterEach(() => {
    vi.clearAllMocks()
    cache.get.mockResolvedValue(undefined)
    cache.set.mockResolvedValue(undefined)
  })

  it('只忽略大小写和分隔符差异', () => {
    /*
     * ================================================================================
     * 步骤1：验证统一番号比较
     * ================================================================================
     * 目标：标点差异允许命中，前缀、后缀或数字变化必须拒绝。
     * 数据源：四组番号比较样本。
     * 操作：
     * 1) 比较大小写、空格、下划线和连字符
     * 2) 比较相似但不同的番号
     */
    testLogger.info('开始验证统一番号比较')

    expect(isSameAvNumber('sora-0636', 'SORA_0636')).toBe(true)
    expect(isSameAvNumber('FC2-PPV-00123456', 'fc2 ppv 00123456')).toBe(true)
    expect(isSameAvNumber('SORA-636', 'SORA-636-C')).toBe(false)
    expect(isSameAvNumber('SORA-636', 'SORA-637')).toBe(false)
    testLogger.info('统一番号比较验证完成')
  })

  it('错误单源缓存被忽略并由精确网络结果替换', async () => {
    /*
     * ================================================================================
     * 步骤1：验证单源缓存刷新
     * ================================================================================
     * 目标：缓存键正确但内容番号错误时，继续请求并缓存精确结果。
     * 数据源：错误缓存和精确网络资料。
     * 操作：
     * 1) 返回相似番号缓存
     * 2) 核对联网结果和新缓存内容
     */
    testLogger.info('开始验证错误单源缓存刷新')
    cache.get.mockResolvedValue({ value: createInfo('SORA-636-C') })
    const source = new TestJav()
    source.networkInfo = createInfo('SORA-636')

    const result = await source.getInfo('SORA-636')

    expect(result?.avNumber).toBe('SORA-636')
    expect(cache.set).toHaveBeenCalledWith('JavBus:SORA-636', result)
    testLogger.info('错误单源缓存刷新验证完成')
  })

  it('错误网络结果不返回也不写缓存', async () => {
    /*
     * ================================================================================
     * 步骤1：验证网络结果隔离
     * ================================================================================
     * 目标：资料源误返相似番号时不能污染当前番号。
     * 数据源：相似番号网络资料。
     * 操作：
     * 1) 请求目标番号并返回带后缀的相似结果
     * 2) 核对结果为空且未写缓存
     */
    testLogger.info('开始验证错误网络结果隔离')
    const source = new TestJav()
    source.networkInfo = createInfo('SORA-636-C')

    await expect(source.getInfo('SORA-636')).resolves.toBeUndefined()
    expect(cache.set).not.toHaveBeenCalled()
    testLogger.info('错误网络结果隔离验证完成')
  })

  it('精确但不完整的网络资料不写长期缓存', async () => {
    /*
     * ================================================================================
     * 步骤1：验证完整缓存门槛
     * ================================================================================
     * 目标：允许页面临时使用精确部分资料，但长期缓存只保存标题和封面齐全的数据。
     * 数据源：缺少封面的精确网络资料。
     * 操作：
     * 1) 返回缺封面的精确资料
     * 2) 核对资料可返回但缓存不写入
     */
    testLogger.info('开始验证完整缓存门槛')
    const source = new TestJav()
    source.networkInfo = createInfo('SORA-636', { cover: undefined })

    const result = await source.getInfo('SORA-636')

    expect(result?.avNumber).toBe('SORA-636')
    expect(cache.set).not.toHaveBeenCalled()
    testLogger.info('完整缓存门槛验证完成')
  })
})
