import type { Page } from '@playwright/test'
import type { MockApi } from './mockApi'
import { globals } from './globals'
import { GM_REQUESTS_KEY, GM_STORE_KEY, gmInit } from './gmStubs'
import { defaults } from './mockApi'
import { userscript } from './userscript'

/**
 * harness 装配：GM 桩 + CDN 全局 + userscript + mock 路由
 * spec 用法：
 *   const api = await setupHarness(page, {
 *     gmValues: { USER_SETTINGS: { enableFilelistPreview: false } },
 *     mocks: api => api.override(FILES_RE, ({ route }) => json(route, 自定义数据)),
 *   })
 *   await page.goto(MASTER_URL)
 */

export const HOME_URL = 'https://115.com/?cid=0&offset=0&mode=wangpan'
export const MASTER_URL = 'https://115.com/web/lixian/master/'
export const OFFICIAL_URL = 'https://115.com/web/new-drive/'
export const OFFICIAL_STORAGE_URL = 'https://115.com/storage/allfiles?cid=0&mode=wangpan'

export interface HarnessOptions {
  /** 初始 GM 值（GM_getValue 数据源，localStorage 持久化） */
  gmValues?: Record<string, unknown>
  /** 追加/覆盖 mock handler（override 先于默认匹配） */
  mocks?: (api: MockApi) => void
}

export async function setupHarness(page: Page, options: HarnessOptions = {}) {
  /** 应用层 localStorage 预设：跳过首次启动的赞助弹窗 */
  await page.addInitScript(() => {
    if (!localStorage.getItem('115master_sponsor_shown'))
      localStorage.setItem('115master_sponsor_shown', 'true')
  })
  await page.addInitScript(gmInit(options.gmValues))
  for (const g of globals())
    await page.addInitScript(g)
  await page.addInitScript(userscript())

  const api = defaults()
  options.mocks?.(api)
  await api.install(page)
  return api
}

/** 收集 pageerror，用例结束统一断言 */
export function watch(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  return errors
}

/** 读取 GM 桩持久化 store（验证 GM_setValue 副作用） */
export function gmStore(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), GM_STORE_KEY)
}

export interface GMRequestLog {
  url: string
  method: string
  headers: Record<string, string>
  cookiePartition?: { topLevelSite?: string }
}

/** 读取 GM_xmlhttpRequest 原始调用参数，不受浏览器 fetch 请求头重写影响。 */
export function gmRequests(page: Page): Promise<GMRequestLog[]> {
  return page.evaluate(
    key => (window as unknown as Record<string, GMRequestLog[]>)[key] ?? [],
    GM_REQUESTS_KEY,
  )
}

export { dirs, filesRes, folder, searchRes, video } from './fixtures/files'
export { spaceInfo } from './fixtures/space'
export { userAq } from './fixtures/user'
export { CORS, FILES_RE, json } from './mockApi'
export type { MockApi } from './mockApi'
