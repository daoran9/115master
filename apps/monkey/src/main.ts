/* eslint-disable perfectionist/sort-imports */
import '@115master/shared/115polyfills'

import { unsafeWindow } from '$'
import globToRegex from 'glob-to-regexp'
import ROUTE_MATCH from './constants/route.match'
import HomePage from './pages/home/index'
import { magnetPage, registerMagnetProtocolHandler } from './pages/magnet'
import OfficialPage from './pages/official'
import { javLibraryWorkerPage } from './pages/javLibraryWorker'
import { videoTokenPage } from './pages/video'
import { checkUserAgent } from './utils/checkUserAgent'
import { debugInfo } from './utils/debugInfo'
import { appLogger } from './utils/logger'

const routerLogger = appLogger.sub('Router')

/** 设置 document.domain 以支持 115 Bridge 跨域通信 */
/** 必须在任何代码执行之前设置 */
try {
  if (document.domain && document.domain.endsWith('115.com')) {
    document.domain = '115.com'
  }
}
catch (error) {
  // 某些浏览器可能不允许设置 domain
  console.warn('[115Master] Failed to set document.domain:', error)
}

/** 调试信息 */
debugInfo.bootstrapInfo()

/** 检查用户代理 */
checkUserAgent()

/** 路由匹配 */
const routeMatch = [
  /** JavLibrary 第一方后台工作页 */
  {
    match: ROUTE_MATCH.JAVLIBRARY_WORKER,
    exec: () => javLibraryWorkerPage(),
  },
  /** 视频页（token中转） */
  {
    match: ROUTE_MATCH.VIDEO_TOKEN,
    exec: () => videoTokenPage(),
  },
  /** 磁力链接页 */
  {
    match: ROUTE_MATCH.MAGNET,
    exec: () => magnetPage(),
  },
  /** 独立网盘页 */
  {
    match: ROUTE_MATCH.MASTER,
    exec: async () => {
      /*
       * ================================================================================
       * 步骤1：按需加载 MASTER 应用
       * ================================================================================
       * 目标：官方新版页面不提前创建 Hash Router，不向当前 URL 追加 #/。
       * 数据源：命中 MASTER_BASE_URL 的独立文件页或播放器页。
       * 操作：
       * 1) 命中后再加载应用模块
       * 2) 创建 MASTER Vue 应用
       */
      routerLogger.info('开始按需加载 MASTER 应用')

      const { createMasterApp } = await import('./app/index')
      const app = createMasterApp()

      routerLogger.info('MASTER 应用按需加载完成')
      return app
    },
  },
  /** 旧版官方首页 */
  {
    match: ROUTE_MATCH.HOME,
    exec: () => unsafeWindow.Main?.CONFIG?.DataListBox
      ? new HomePage()
      : new OfficialPage(),
  },
  /** 新版或未知的 115 页面 */
  {
    match: ROUTE_MATCH.OFFICIAL,
    exec: () => new OfficialPage(),
  },
]

/** 主函数 */
async function main() {
  const logger = routerLogger

  /*
   * ================================================================================
   * 步骤1：选择唯一页面入口
   * ================================================================================
   * 目标：按具体路由优先级分发页面，避免一个 URL 重复初始化多个入口。
   * 操作：
   * 1) 从 token、Magnet、MASTER 到官方页面依次匹配
   * 2) 命中首个入口后立即返回
   */
  logger.info('开始匹配页面入口', window.location.href)

  for (const route of routeMatch) {
    if (globToRegex(route.match).test(window.location.href)) {
      /*
       * ================================================================================
       * 步骤2：初始化页面入口
       * ================================================================================
       * 目标：让单个入口初始化异常不会阻断新版页面的兼容入口。
       * 数据源：当前 URL 命中的 route.exec。
       * 操作：
       * 1) 执行页面入口
       * 2) 记录异常并继续完成可用性兜底
       */
      logger.info('开始初始化页面入口', route.match)
      try {
        // 2.1 执行当前路由入口
        await route.exec()
        logger.info('页面入口初始化完成', route.match)
      }
      catch (error) {
        // 2.2 记录入口异常，避免用户看到完全无 UI 的页面
        logger.error('页面入口初始化失败', route.match, error)
        if (route.match === ROUTE_MATCH.OFFICIAL) {
          try {
            /** 2.3 新版页面失败时重新挂载隔离启动入口 */
            const fallbackPage = new OfficialPage()
            logger.info('新版页面隔离入口兜底完成', fallbackPage.constructor.name)
          }
          catch (fallbackError) {
            logger.error('新版页面隔离入口兜底失败', fallbackError)
          }
        }
      }

      /*
       * ================================================================================
       * 步骤3：完成可选协议注册
       * ================================================================================
       * 目标：把可能被浏览器拒绝的协议注册放到页面入口之后。
       * 数据源：navigator.registerProtocolHandler。
       * 操作：
       * 1) 尝试注册磁力协议
       * 2) 由函数内部隔离浏览器异常
       */
      logger.info('开始完成可选协议注册')
      // 3.1 协议注册失败不影响已创建的页面入口
      if (route.match !== ROUTE_MATCH.JAVLIBRARY_WORKER)
        registerMagnetProtocolHandler()
      logger.info('可选协议注册步骤结束')
      logger.info('页面入口初始化完成', route.match)
      return
    }
  }

  logger.info('页面入口匹配完成，当前 URL 无对应入口')
}

/** 文档加载完成 */
if (
  document.readyState === 'complete'
  || document.readyState === 'interactive'
) {
  void main()
}
else {
  window.addEventListener('DOMContentLoaded', () => void main())
}
