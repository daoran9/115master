/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { IRequest, RequestOptions } from '@115master/shared'
import { Logger } from '@115master/shared'
import { describe, expect, it, vi } from 'vitest'
import { calculateEd2k } from '../calculate'
import {
  ED2K_PART_SIZE,
  finishEd2kHash,
  hashEd2kPart,
} from '../hash'

const logger = new Logger('ED2KCalculateTest')
const SOURCE_URL = 'https://cdnfhnfile.115cdn.net/concurrent-ed2k.mp4'

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

describe('calculateEd2k concurrent ranges', () => {
  /**
   * ============================================================================
   * 步骤1：验证三路并发与摘要顺序
   * ============================================================================
   * 目标：三个 Range 同时在途，倒序返回时仍按文件顺序汇总摘要。
   * 数据源：两个标准分块和一个三字节尾块。
   * 操作：
   * 1) 等待三个请求全部开始
   * 2) 按 3、2、1 的顺序释放响应
   * 3) 核对最终标准 ED2K 链
   */
  it('downloads three ranges concurrently and preserves part order', async () => {
    logger.info('开始验证 ED2K 三路 Range 并发')

    // 1.1 三个分块内容不同，摘要乱序会直接改变最终文件哈希
    const chunks = [
      new Uint8Array(ED2K_PART_SIZE).fill(1),
      new Uint8Array(ED2K_PART_SIZE).fill(2),
      new TextEncoder().encode('abc'),
    ]
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    const expected = await finishEd2kHash(
      await Promise.all(chunks.map(chunk => hashEd2kPart(chunk))),
      size,
    )
    const gates = chunks.map(() => deferred())
    const resolve = vi.fn(async () => ({ url: SOURCE_URL }))
    let active = 0
    let maximum = 0

    const get = vi.fn<IRequest['get']>(async (_url, options) => {
      const value = range(options)
      const index = value.start / ED2K_PART_SIZE
      active += 1
      maximum = Math.max(maximum, active)
      await gates[index]!.promise
      active -= 1

      const body = chunks[index]!.slice().buffer as ArrayBuffer
      return new Response(body, {
        headers: {
          'content-range': `bytes ${value.start}-${value.end}/${size}`,
        },
        status: 206,
      })
    })

    // 1.2 在任何响应返回前，三个下载槽都必须已经发出请求
    const pending = calculateEd2k({
      name: '三路并发.mp4',
      resolve,
      size,
    }, { request: request(get) })
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(3))
    expect(resolve).toHaveBeenCalledTimes(3)
    expect(maximum).toBe(3)

    // 1.3 倒序完成不能改变 ED2K 分块摘要的文件顺序
    gates[2]!.resolve()
    gates[1]!.resolve()
    gates[0]!.resolve()
    await expect(pending).resolves.toBe(
      `ed2k://|file|三路并发.mp4|${size}|${expected}|/`,
    )

    logger.info('ED2K 三路 Range 并发验证完成')
  })

  /**
   * ============================================================================
   * 步骤2：验证并发失败联动取消
   * ============================================================================
   * 目标：任一 Range 失败后立即中止其他在途请求。
   * 数据源：首段主动失败、其余两段等待取消的请求桩。
   * 操作：
   * 1) 等待三个请求全部开始
   * 2) 触发首段失败
   * 3) 核对另外两个请求收到取消信号
   */
  it('aborts sibling ranges when one range fails', async () => {
    logger.info('开始验证 ED2K 并发失败取消')

    const gate = deferred()
    const aborted: number[] = []
    const size = ED2K_PART_SIZE * 2 + 1
    const get = vi.fn<IRequest['get']>(async (_url, options) => {
      const index = range(options).start / ED2K_PART_SIZE
      if (index === 0) {
        await gate.promise
        throw new Error('首段下载失败')
      }

      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          aborted.push(index)
          reject(options.signal?.reason)
        }, { once: true })
      })
    })

    // 2.1 三个请求全部在途后再触发失败，确保覆盖联动取消
    const pending = calculateEd2k({
      name: '并发取消.mp4',
      size,
      url: SOURCE_URL,
    }, { request: request(get) })
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(3))
    gate.resolve()

    // 2.2 主错误保持不变，另外两个下载槽都收到同一内部取消
    await expect(pending).rejects.toThrow('首段下载失败')
    expect(aborted.sort()).toEqual([1, 2])

    logger.info('ED2K 并发失败取消验证完成')
  })

  /**
   * ============================================================================
   * 步骤3：验证非 206 自动回退
   * ============================================================================
   * 目标：CDN 拒绝多路 Range 时改用新地址单连接完成任务。
   * 数据源：并发连接返回 200、串行连接返回标准 206 的请求桩。
   * 操作：
   * 1) 触发两路并发并返回一个 200
   * 2) 核对旧请求取消和新连接串行读取
   * 3) 核对最终 ED2K 链
   */
  it('falls back to one connection when parallel ranges are rejected', async () => {
    logger.info('开始验证 ED2K 非 206 串行回退')

    // 3.1 两个不同分块用于确认串行重试仍保持文件顺序
    const chunks = [
      new Uint8Array(ED2K_PART_SIZE).fill(3),
      new Uint8Array(1).fill(4),
    ]
    const size = ED2K_PART_SIZE + 1
    const expected = await finishEd2kHash(
      await Promise.all(chunks.map(chunk => hashEd2kPart(chunk))),
      size,
    )
    let connection = 0
    const resolve = vi.fn(async () => ({
      url: `${SOURCE_URL}?connection=${++connection}`,
    }))
    const aborted: number[] = []

    const get = vi.fn<IRequest['get']>(async (url, options) => {
      const value = range(options)
      const index = value.start / ED2K_PART_SIZE
      const id = Number(new URL(url).searchParams.get('connection'))

      if (id === 2)
        return new Response('range rejected', { status: 200 })
      if (id === 1) {
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            aborted.push(id)
            reject(options.signal?.reason)
          }, { once: true })
        })
      }

      return new Response(chunks[index]!.slice().buffer as ArrayBuffer, {
        headers: {
          'content-range': `bytes ${value.start}-${value.end}/${size}`,
        },
        status: 206,
      })
    })

    // 3.2 首轮两路使用独立地址；200 触发取消后只创建一个串行地址
    const pending = calculateEd2k({
      name: '自适应回退.mp4',
      resolve,
      size,
    }, { request: request(get) })

    // 3.3 串行地址依次读取两个 Range，并生成相同标准摘要
    await expect(pending).resolves.toBe(
      `ed2k://|file|自适应回退.mp4|${size}|${expected}|/`,
    )
    expect(resolve).toHaveBeenCalledTimes(3)
    expect(aborted).toEqual([1])
    expect(get).toHaveBeenCalledTimes(4)

    logger.info('ED2K 非 206 串行回退验证完成')
  })
})
