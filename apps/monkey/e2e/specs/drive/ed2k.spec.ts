/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { Item } from '../../support/fixtures/files'
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
      expect.objectContaining({ headers: expect.objectContaining({ Range: 'bytes=0-2' }) }),
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
    await expect.poll(async () => (await gmRequests(page)).some(request => request.url === FILE_URL))
      .toBe(true)

    // 3.3 取消关闭进度弹窗，完成态和错误态均不应出现
    const progress = page.getByRole('dialog', { name: '生成 ED2K 链' })
    await progress.getByRole('button', { name: '取消' }).click()
    await expect(progress).toHaveCount(0)
    await page.waitForTimeout(1_100)
    await expect(page.getByRole('dialog', { name: 'ED2K 链已生成' })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'ED2K 生成失败' })).toHaveCount(0)
    expect(errors).toEqual([])
    logger.info('ED2K 进行中取消验证完成')
  })
})
