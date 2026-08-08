/* eslint-disable perfectionist/sort-imports */
import '@115master/shared/115polyfills'

import { unsafeWindow } from '$'
import globToRegex from 'glob-to-regexp'
import { createMasterApp } from './app/index'
import ROUTE_MATCH from './constants/route.match'
import HomePage from './pages/home/index'
import { magnetPage, registerMagnetProtocolHandler } from './pages/magnet'
import OfficialPage from './pages/official'
import { videoTokenPage } from './pages/video'
import { checkUserAgent } from './utils/checkUserAgent'
import { debugInfo } from './utils/debugInfo'
import { appLogger } from './utils/logger'

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

/** 注册磁力链接协议处理程序 */
registerMagnetProtocolHandler()

/** 路由匹配 */
const routeMatch = [
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
    exec: () => createMasterApp(),
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
function main() {
  const logger = appLogger.sub('Router')

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
      route.exec()
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
  main()
}
else {
  window.addEventListener('DOMContentLoaded', main)
}
