import type { RouterHistory } from 'vue-router'
import { createMemoryHistory, createRouter, createWebHashHistory } from 'vue-router'
import { routes } from '@/app/routes'
import { MASTER_BASE_URL } from '@/constants'
import { appLogger } from '@/utils/logger'

const logger = appLogger.sub('AppRouter')

/** 兼容旧版播放页地址重定向（在 router 创建前执行） */
/** e.g. /master/video/?pick_code=xxx → /master/#/video/xxx */
function legacyRedirect() {
  if (!window.location.pathname.includes('/master/video'))
    return
  const pickCode = new URLSearchParams(window.location.search).get('pick_code')
  if (!pickCode)
    return
  history.replaceState(null, '', `${MASTER_BASE_URL}/#/video/${pickCode}`)
}

legacyRedirect()

function createMasterHistory(): RouterHistory {
  /*
   * ================================================================================
   * 步骤1：选择 MASTER 路由历史
   * ================================================================================
   * 目标：MASTER 页面使用 Hash Router，其他 115 页面不改动当前 URL。
   * 数据源：当前 pathname 与 MASTER_BASE_URL。
   * 操作：
   * 1) MASTER 页面创建 Web Hash History
   * 2) 其他页面使用无 URL 副作用的 Memory History
   */
  logger.info('开始选择 MASTER 路由历史', window.location.pathname)

  const isMasterPage = window.location.pathname.startsWith(
    new URL(MASTER_BASE_URL).pathname,
  )
  const history = isMasterPage
    ? createWebHashHistory()
    : createMemoryHistory()

  logger.info('MASTER 路由历史选择完成', isMasterPage ? 'hash' : 'memory')
  return history
}

export const router = createRouter({
  history: createMasterHistory(),
  routes,
  scrollBehavior: async (to, _from, savedPosition) => {
    /** drive 路由由页面自己管理滚动位置 */
    if (to.name === 'drive')
      return false
    if (savedPosition)
      return savedPosition
    return { top: 0 }
  },
})
