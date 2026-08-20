/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { IRequest, RequestOptions } from '@115master/shared'
import { InfraError, Logger } from '@115master/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateEd2k,
  ED2K_BATCH_PARTS,
  ED2K_BATCH_SIZE,
  ED2K_NETWORK_RETRIES,
} from '../calculate'
import {
  ED2K_PART_SIZE,
  finishEd2kHash,
  hashEd2kPart,
} from '../hash'

vi.mock('../hash', async (importOriginal) => {
  const original = await importOriginal<typeof import('../hash')>()
  return {
    ...original,
    hashEd2kPart: vi.fn(async (data: Uint8Array) => (
      (data[0] ?? 0).toString(16).padStart(2, '0').repeat(16).toUpperCase()
    )),
  }
})

const logger = new Logger('ED2KCalculateTest')
const SOURCE_URL = 'https://cdnfhnfile.115cdn.net/batched-ed2k.mp4'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function range(options?: RequestOptions) {
  const value = new Headers(options?.headers).get('range')
  const match = value?.match(/^bytes=(\d+)-(\d+)$/)
  if (!match)
    throw new Error('测试请求缺少 Range')
  return { end: Number(match[2]), start: Number(match[1]) }
}

function request(get: IRequest['get']): IRequest {
  return {
    get,
    post: vi.fn(),
    request: vi.fn(),
  }
}

function digest(value: number) {
  return value.toString(16).padStart(2, '0').repeat(16).toUpperCase()
}

function bytes(size: number, first: number) {
  const data = new Uint8Array(size)
  const count = Math.ceil(size / ED2K_PART_SIZE)
  Array.from({ length: count }, (_, index) => index).forEach((index) => {
    data.fill(
      first + index,
      index * ED2K_PART_SIZE,
      Math.min((index + 1) * ED2K_PART_SIZE, size),
    )
  })
  return data
}

function response(data: Uint8Array, value: { end: number, start: number }, total: number) {
  return new Response(data.slice().buffer as ArrayBuffer, {
    headers: {
      'content-range': `bytes ${value.start}-${value.end}/${total}`,
    },
    status: 206,
  })
}

async function expected(values: number[], size: number) {
  return finishEd2kHash(values.map(digest), size)
}

describe('calculateEd2k batched ranges', () => {
  beforeEach(() => {
    vi.mocked(hashEd2kPart).mockClear()
  })

  /**
   * ============================================================================
   * 步骤1：验证四块网络批次与协议边界
   * ============================================================================
   * 目标：一个 Range 精确读取四个 ED2K 块，摘要仍按标准块分别计算。
   * 数据源：四个首字节不同的 9,728,000 字节协议块。
   * 操作：
   * 1) 核对单次 Range 边界
   * 2) 核对四次摘要输入长度
   * 3) 核对最终 ED2K 链
   */
  it('reads four protocol parts in one network range', async () => {
    logger.info('开始验证 ED2K 四块网络批次')

    // 1.1 单个网络响应包含四个内容可区分的标准协议块
    const data = bytes(ED2K_BATCH_SIZE, 1)
    const get = vi.fn<IRequest['get']>(async (_url, options) => {
      const value = range(options)
      return response(data, value, data.byteLength)
    })

    // 1.2 网络层只发一个 38,912,000 字节 Range
    const result = await calculateEd2k({
      name: '四块批次.mp4',
      size: data.byteLength,
      url: SOURCE_URL,
    }, { request: request(get) })
    expect(get).toHaveBeenCalledTimes(1)
    expect(range(get.mock.calls[0]![1])).toEqual({
      end: ED2K_BATCH_SIZE - 1,
      start: 0,
    })

    // 1.3 MD4 输入仍是四个独立的 9,728,000 字节块
    expect(ED2K_BATCH_PARTS).toBe(4)
    expect(vi.mocked(hashEd2kPart).mock.calls.map(call => call[0].byteLength))
      .toEqual(Array.from({ length: ED2K_BATCH_PARTS }, () => ED2K_PART_SIZE))
    await expect(expected([1, 2, 3, 4], data.byteLength)).resolves.toBe(
      result.match(/\|(\w{32})\|\/$/)?.[1],
    )

    logger.info('ED2K 四块网络批次验证完成')
  })

  /**
   * ============================================================================
   * 步骤2：验证单连接下载与哈希流水线
   * ============================================================================
   * 目标：当前批次计算摘要时，单连接已经开始读取下一批次。
   * 数据源：一个完整四块批次和一个单字节尾批次。
   * 操作：
   * 1) 暂停首个协议摘要
   * 2) 核对尾批次已开始下载
   * 3) 释放摘要并核对最终顺序
   */
  it('pipelines the next download while preserving protocol part order', async () => {
    logger.info('开始验证 ED2K 单连接批次流水线')

    // 2.1 首个协议摘要暂停时，其余摘要仍可进入同一批次任务
    const size = ED2K_BATCH_SIZE + 1
    const gate = deferred()
    const resolve = vi.fn(async () => ({ url: SOURCE_URL }))
    vi.mocked(hashEd2kPart).mockImplementationOnce(async (data) => {
      await gate.promise
      return digest(data[0] ?? 0)
    })
    const get = vi.fn<IRequest['get']>(async (_url, options) => {
      const value = range(options)
      const index = value.start / ED2K_BATCH_SIZE
      return response(
        bytes(value.end - value.start + 1, index === 0 ? 1 : 5),
        value,
        size,
      )
    })

    // 2.2 首批摘要未完成前，下一批 Range 已经由同一下载槽发出
    const pending = calculateEd2k({
      name: '单连接流水线.mp4',
      resolve,
      size,
    }, { request: request(get) })
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    gate.resolve()

    // 2.3 一个地址和一个下载槽完成两批，协议摘要仍保持文件顺序
    await expect(pending).resolves.toBe(
      `ed2k://|file|单连接流水线.mp4|${size}|${await expected([1, 2, 3, 4, 5], size)}|/`,
    )
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(get.mock.calls.map(call => range(call[1]).start)).toEqual([
      0,
      ED2K_BATCH_SIZE,
    ])

    logger.info('ED2K 单连接批次流水线验证完成')
  })

  /**
   * ============================================================================
   * 步骤3：验证失败批次刷新地址续算
   * ============================================================================
   * 目标：尾批次网络失败后只重试尾批次，首批次摘要不重复计算。
   * 数据源：首次请求失败的单字节尾批次和递增 token 的临时地址。
   * 操作：
   * 1) 让尾批次首次返回可重试错误
   * 2) 等待刷新地址后成功
   * 3) 核对首批次请求和摘要只出现一次
   */
  it('refreshes the endpoint and resumes only the failed batch', async () => {
    logger.info('开始验证 ED2K 失败批次续算')

    // 3.1 每次解析返回不同地址，尾批次第一次模拟 GM onerror
    const size = ED2K_BATCH_SIZE + 1
    let token = 0
    let tail = 0
    const urls: string[] = []
    const resolve = vi.fn(async () => ({
      url: `${SOURCE_URL}?token=${++token}`,
    }))
    const get = vi.fn<IRequest['get']>(async (url, options) => {
      const value = range(options)
      urls.push(url)
      if (value.start === ED2K_BATCH_SIZE && tail++ === 0)
        throw new InfraError('请求失败', url, undefined, true)
      return response(
        bytes(value.end - value.start + 1, value.start === 0 ? 1 : 5),
        value,
        size,
      )
    })

    // 3.2 尾批次等待后刷新地址重试，首批次已完成摘要保留
    await expect(calculateEd2k({
      name: '失败续算.mp4',
      resolve,
      size,
    }, { request: request(get) })).resolves.toBe(
      `ed2k://|file|失败续算.mp4|${size}|${await expected([1, 2, 3, 4, 5], size)}|/`,
    )

    // 3.3 首批次不再下载或哈希，重试批次使用新临时地址
    const ranges = get.mock.calls.map(call => range(call[1]).start)
    expect(ranges.filter(start => start === 0)).toHaveLength(1)
    expect(ranges.filter(start => start === ED2K_BATCH_SIZE)).toHaveLength(2)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(urls[1]).not.toBe(urls[2])
    expect(hashEd2kPart).toHaveBeenCalledTimes(5)

    logger.info('ED2K 失败批次续算验证完成')
  })

  /**
   * ============================================================================
   * 步骤4：验证网络重试上限
   * ============================================================================
   * 目标：初次请求后最多再重试三次，每次都刷新临时地址。
   * 数据源：持续返回可重试 InfraError 的单字节文件。
   * 操作：
   * 1) 持续触发网络失败
   * 2) 等待指数退避完成
   * 3) 核对总请求数和地址解析次数
   */
  it('stops after three network retries', async () => {
    logger.info('开始验证 ED2K 网络重试上限')

    // 4.1 每次 Range 请求都模拟 GM_xmlhttpRequest.onerror
    let token = 0
    const resolve = vi.fn(async () => ({
      url: `${SOURCE_URL}?token=${++token}`,
    }))
    const get = vi.fn<IRequest['get']>(async (url) => {
      throw new InfraError('请求失败', url, undefined, true)
    })

    // 4.2 初次请求加三次重试后返回最后一个网络错误
    await expect(calculateEd2k({
      name: '重试上限.mp4',
      resolve,
      size: 1,
    }, { request: request(get) })).rejects.toThrow('请求失败')

    // 4.3 每次重试都重新解析临时地址，不能复用失效 token
    expect(get).toHaveBeenCalledTimes(ED2K_NETWORK_RETRIES + 1)
    expect(resolve).toHaveBeenCalledTimes(ED2K_NETWORK_RETRIES + 1)
    expect(new Set(get.mock.calls.map(call => call[0])).size)
      .toBe(ED2K_NETWORK_RETRIES + 1)

    logger.info('ED2K 网络重试上限验证完成')
  }, 8_000)

  /**
   * ============================================================================
   * 步骤5：验证重试等待可立即取消
   * ============================================================================
   * 目标：用户取消后终止退避计时，不再刷新地址或发出 Range。
   * 数据源：首次请求失败后进入等待的单字节文件。
   * 操作：
   * 1) 等待首次网络失败
   * 2) 在重试计时内取消
   * 3) 核对没有后续地址解析和请求
   */
  it('cancels immediately while waiting to retry', async () => {
    logger.info('开始验证 ED2K 重试等待取消')

    // 5.1 首次请求失败后进入 500ms 重试等待
    const controller = new AbortController()
    const resolve = vi.fn(async () => ({ url: SOURCE_URL }))
    const get = vi.fn<IRequest['get']>(async (url) => {
      throw new InfraError('请求失败', url, undefined, true)
    })
    const pending = calculateEd2k({
      name: '取消重试.mp4',
      resolve,
      size: 1,
    }, {
      request: request(get),
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    // 5.2 取消必须立即结束任务，不等待退避计时结束
    const started = performance.now()
    controller.abort(new DOMException('用户取消', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(performance.now() - started).toBeLessThan(250)

    // 5.3 取消后的计时器不能再刷新地址或发出请求
    await new Promise(resolve => setTimeout(resolve, 550))
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(1)

    logger.info('ED2K 重试等待取消验证完成')
  })

  /**
   * ============================================================================
   * 步骤6：验证非 206 刷新地址续算
   * ============================================================================
   * 目标：CDN 临时返回非 206 时保留首批摘要并刷新单连接地址。
   * 数据源：首批成功、尾批返回 200、新地址返回标准 206 的请求桩。
   * 操作：
   * 1) 单连接依次读取两个批次并让尾批返回 200
   * 2) 核对新连接只补算尾批次
   * 3) 核对首批摘要没有重复计算
   */
  it('keeps completed hashes when an invalid range refreshes the URL', async () => {
    logger.info('开始验证 ED2K 批次非 206 地址刷新')

    // 6.1 首个地址完成首批后，在尾批返回非 206
    const size = ED2K_BATCH_SIZE + 1
    let connection = 0
    const resolve = vi.fn(async () => ({
      url: `${SOURCE_URL}?connection=${++connection}`,
    }))
    const get = vi.fn<IRequest['get']>(async (url, options) => {
      const value = range(options)
      const index = value.start / ED2K_BATCH_SIZE
      const id = Number(new URL(url).searchParams.get('connection'))

      if (id === 1 && index === 1)
        return new Response('range rejected', { status: 200 })

      return response(
        bytes(value.end - value.start + 1, index === 0 ? 1 : 5),
        value,
        size,
      )
    })

    // 6.2 尾批被拒绝后，新地址只读取尚未完成的尾批次
    await expect(calculateEd2k({
      name: '自适应回退.mp4',
      resolve,
      size,
    }, { request: request(get) })).resolves.toBe(
      `ed2k://|file|自适应回退.mp4|${size}|${await expected([1, 2, 3, 4, 5], size)}|/`,
    )

    // 6.3 首批不重复下载或哈希，进度状态复用同一组已完成摘要
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledTimes(3)
    expect(get.mock.calls.map(call => range(call[1]).start)).toEqual([
      0,
      ED2K_BATCH_SIZE,
      ED2K_BATCH_SIZE,
    ])
    expect(hashEd2kPart).toHaveBeenCalledTimes(5)

    logger.info('ED2K 批次非 206 地址刷新验证完成')
  })
})
