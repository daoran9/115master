/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { Item } from '../../support/fixtures/files'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { CORS, FILES_RE, filesRes, folder, gmRequests, json, video } from '../../support'
import { boot, menu, row, watch } from './helpers'

const FILE_URL = 'https://cdnfhnfile.115cdn.net/ed2k-fixture.mp4'
const DOWNLOAD_RE = /^https:\/\/webapi\.115\.com\/files\/download/
const SOURCE_RE = /^https:\/\/cdnfhnfile\.115cdn\.net\/ed2k-fixture\.mp4/
const logger = console

function files(item: Item) {
  return filesRes({
    cid: '0',
    name: '根目录',
    items: [folder('1001', '动漫', '0'), item],
  }, 0, 30)
}

function fixture(name = 'ED2K 测试视频.mp4') {
  return { ...video(name, '0'), s: 3 }
}

test.describe('ED2K 链', () => {
  /**
   * ============================================================================
   * 步骤1：验证完整离线生成链
   * ============================================================================
   * 目标：从单视频右键菜单生成标准 ED2K 链。
   * 数据源：离线文件列表、下载地址和 Range 206 字节 abc。
   * 操作：
   * 1) 触发单文件操作
   * 2) 核对 Range 请求和最终链接
   */
  test('generates a standard link from a 206 range response', async ({ page }) => {
    const errors = watch(page)
    const item = fixture()
    await boot(page, {
      mocks: (api) => {
        api.override(FILES_RE, ({ route }) => json(route, files(item)))
        api.override(DOWNLOAD_RE, ({ route }) => json(route, { state: true, file_url: FILE_URL }))
        api.override(SOURCE_RE, async ({ route, request }) => {
          expect(request.headers().range).toBe('bytes=0-2')
          await route.fulfill({
            status: 206,
            headers: {
              ...CORS,
              'access-control-expose-headers': 'Content-Range',
              'content-range': 'bytes 0-2/3',
            },
            body: 'abc',
          })
          return true
        })
      },
    })
    logger.info('开始验证离线 ED2K 生成链')

    // 1.1 单视频右键菜单公开显式生成入口
    await row(page, item.n).click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: '生成 ED2K 链' }).click()
    await expect(page.getByRole('dialog', { name: '生成 ED2K 链' })).toBeVisible()

    // 1.2 结果与 RFC MD4 向量一致，网络只读取声明的 Range
    const result = page.getByRole('dialog', { name: 'ED2K 链已生成' })
    await expect(result).toBeVisible()
    await expect(result.getByRole('textbox', { name: 'ED2K 链' })).toHaveValue(
      'ed2k://|file|ED2K 测试视频.mp4|3|A448017AAF21D8525FC10AE87AA6729D|/',
    )
    const requests = await gmRequests(page)
    expect(requests.filter(request => request.url === FILE_URL)).toEqual([
      expect.objectContaining({
        headers: expect.objectContaining({
          'Range': 'bytes=0-2',
          'User-Agent': expect.any(String),
        }),
      }),
    ])
    expect(errors).toEqual([])
    logger.info('离线 ED2K 生成链验证完成')
  })

  /**
   * ============================================================================
   * 步骤2：验证 Range 安全门禁
   * ============================================================================
   * 目标：服务器忽略 Range 并返回 200 时停止，避免整文件一次性进入内存。
   * 数据源：离线 200 响应。
   * 操作：
   * 1) 触发生成
   * 2) 核对失败提示
   */
  test('stops when the source ignores Range and returns 200', async ({ page }) => {
    const errors = watch(page)
    const item = fixture('不支持 Range.mp4')
    await boot(page, {
      mocks: (api) => {
        api.override(FILES_RE, ({ route }) => json(route, files(item)))
        api.override(DOWNLOAD_RE, ({ route }) => json(route, { state: true, file_url: FILE_URL }))
        api.override(SOURCE_RE, async ({ route }) => {
          await route.fulfill({ status: 200, headers: CORS, body: 'abc' })
          return true
        })
      },
    })
    logger.info('开始验证 ED2K Range 安全门禁')

    // 2.1 从单视频菜单触发相同计算链
    await row(page, item.n).click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: '生成 ED2K 链' }).click()

    // 2.2 200 响应必须转为明确错误，且不能展示伪链接
    const failure = page.getByRole('dialog', { name: 'ED2K 生成失败' })
    await expect(failure).toContainText('服务器不支持 Range 206')
    await expect(page.getByRole('dialog', { name: 'ED2K 链已生成' })).toHaveCount(0)
    expect(errors).toEqual([])
    logger.info('ED2K Range 安全门禁验证完成')
  })

  /**
   * ============================================================================
   * 步骤3：验证进行中取消
   * ============================================================================
   * 目标：用户取消后中断当前 Range 请求，并且不显示成功或失败结果。
   * 数据源：延迟返回的离线 Range 端点。
   * 操作：
   * 1) 等待 Range 请求开始
   * 2) 点击取消并核对弹窗状态
   */
  test('cancels an in-flight range request without showing a result', async ({ page }) => {
    const errors = watch(page)
    const item = fixture('取消 ED2K.mp4')
    await boot(page, {
      mocks: (api) => {
        api.override(FILES_RE, ({ route }) => json(route, files(item)))
        api.override(DOWNLOAD_RE, ({ route }) => json(route, { state: true, file_url: FILE_URL }))
        api.override(SOURCE_RE, async ({ route }) => {
          await new Promise(resolve => setTimeout(resolve, 1_000))
          try {
            await route.fulfill({
              status: 206,
              headers: {
                ...CORS,
                'access-control-expose-headers': 'Content-Range',
                'content-range': 'bytes 0-2/3',
              },
              body: 'abc',
            })
          }
          catch {
            // 3.2 请求已取消时，Playwright 路由无需再返回响应
          }
          return true
        })
      },
    })
    logger.info('开始验证 ED2K 进行中取消')

    // 3.1 确认 Range 请求已经发出，避免只覆盖计算前取消
    await row(page, item.n).click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: '生成 ED2K 链' }).click()
    const progress = page.getByRole('dialog', { name: '生成 ED2K 链' })
    await expect.poll(async () => (await gmRequests(page)).some(request => request.url === FILE_URL))
      .toBe(true)
    await expect(progress).toContainText('正在读取文件')

    // 3.3 取消关闭进度弹窗，完成态和错误态均不应出现
    await progress.getByRole('button', { name: '取消' }).click()
    await expect(progress).toHaveCount(0)
    await page.waitForTimeout(1_100)
    await expect(page.getByRole('dialog', { name: 'ED2K 链已生成' })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'ED2K 生成失败' })).toHaveCount(0)
    expect(errors).toEqual([])
    logger.info('ED2K 进行中取消验证完成')
  })

  /**
   * ============================================================================
   * 步骤4：验证 Worker 静默失败回退
   * ============================================================================
   * 目标：Worker 未返回 message 或 error 时仍由页面完成分块摘要。
   * 数据源：不响应 postMessage 的 Worker 桩和 Range 206 字节 abc。
   * 操作：
   * 1) 等待启动握手超时
   * 2) 核对主线程回退生成的标准链接
   */
  test('falls back when the worker does not respond', async ({ page }) => {
    await page.addInitScript(() => {
      class SilentWorker extends EventTarget {
        postMessage() {}
        terminate() {}
      }
      Object.defineProperty(window, 'Worker', {
        configurable: true,
        value: SilentWorker as unknown as typeof Worker,
      })
    })
    const errors = watch(page)
    const item = fixture('Worker 回退.mp4')
    await boot(page, {
      mocks: (api) => {
        api.override(FILES_RE, ({ route }) => json(route, files(item)))
        api.override(DOWNLOAD_RE, ({ route }) => json(route, { state: true, file_url: FILE_URL }))
        api.override(SOURCE_RE, async ({ route }) => {
          await route.fulfill({
            status: 206,
            headers: {
              ...CORS,
              'access-control-expose-headers': 'Content-Range',
              'content-range': 'bytes 0-2/3',
            },
            body: 'abc',
          })
          return true
        })
      },
    })
    logger.info('开始验证 ED2K Worker 静默失败回退')

    // 4.1 触发生成并等待 Worker 启动超时后的页面计算
    await row(page, item.n).click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: '生成 ED2K 链' }).click()

    // 4.2 回退结果必须与 Worker 正常路径使用相同 MD4 摘要
    const result = page.getByRole('dialog', { name: 'ED2K 链已生成' })
    await expect(result.getByRole('textbox', { name: 'ED2K 链' })).toHaveValue(
      'ed2k://|file|Worker 回退.mp4|3|A448017AAF21D8525FC10AE87AA6729D|/',
    )
    expect(errors).toEqual([])
    logger.info('ED2K Worker 静默失败回退验证完成')
  })

  /**
   * ============================================================================
   * 步骤5：验证四块批次失败后续算
   * ============================================================================
   * 目标：首批次完成后，尾批次断网会刷新地址并只重试尾批次。
   * 数据源：38,912,000 字节首批次、三字节尾批次和一次连接重置。
   * 操作：
   * 1) 为两条下载通道返回带独立 token 的临时地址
   * 2) 让尾批次首次请求断网
   * 3) 核对 Range 次数、地址刷新和最终链接
   */
  test('resumes a failed four-part batch with a refreshed URL', async ({ page }) => {
    test.slow()
    const errors = watch(page)
    const partSize = 9_728_000
    const batchSize = partSize * 4
    const size = batchSize + 3
    const item = { ...fixture('四块批次续算.mp4'), s: size }
    const expected = '85F8C66EC4FEE811C7524DAC889E091C'
    let links = 0
    let tail = 0
    await boot(page, {
      mocks: (api) => {
        api.override(FILES_RE, ({ route }) => json(route, files(item)))
        api.override(DOWNLOAD_RE, ({ route }) => json(route, {
          file_url: `${FILE_URL}?token=${++links}`,
          state: true,
        }))
        api.override(SOURCE_RE, async ({ route, request }) => {
          const value = request.headers().range
          if (value === `bytes=${batchSize}-${batchSize + 2}` && tail++ === 0) {
            await route.abort('connectionreset')
            return true
          }

          const first = value === `bytes=0-${batchSize - 1}`
          expect(first || value === `bytes=${batchSize}-${batchSize + 2}`).toBe(true)
          await route.fulfill({
            status: 206,
            headers: {
              ...CORS,
              'access-control-expose-headers': 'Content-Range',
              'content-range': first
                ? `bytes 0-${batchSize - 1}/${size}`
                : `bytes ${batchSize}-${batchSize + 2}/${size}`,
            },
            body: first ? Buffer.alloc(batchSize) : Buffer.from('abc'),
          })
          return true
        })
      },
    })
    logger.info('开始验证离线 ED2K 四块批次失败续算')

    // 5.1 从单视频菜单启动两个网络批次
    await row(page, item.n).click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: '生成 ED2K 链' }).click()

    // 5.2 尾批次断网后刷新地址，任务仍生成完整标准链接
    const result = page.getByRole('dialog', { name: 'ED2K 链已生成' })
    await expect(result.getByRole('textbox', { name: 'ED2K 链' })).toHaveValue(
      `ed2k://|file|四块批次续算.mp4|${size}|${expected}|/`,
    )

    // 5.3 已完成首批次只读取一次，尾批次两次且刷新了 token
    const requests = (await gmRequests(page)).filter(request => SOURCE_RE.test(request.url))
    const first = requests.filter(request => request.headers.Range === `bytes=0-${batchSize - 1}`)
    const retries = requests.filter(request => request.headers.Range === `bytes=${batchSize}-${batchSize + 2}`)
    expect(first).toHaveLength(1)
    expect(retries).toHaveLength(2)
    expect(retries[0]!.url).not.toBe(retries[1]!.url)
    expect(links).toBe(3)
    expect(errors).toEqual([])
    logger.info('离线 ED2K 四块批次失败续算验证完成')
  })
})
