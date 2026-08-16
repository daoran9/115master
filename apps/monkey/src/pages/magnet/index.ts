import { openOfflineTask } from '@/pages/home/TopHeaderMod/openOfflineTask'
import { appLogger } from '@/utils/logger'

/** 磁力链接任务键名 */
const MAGNET_TASK_KEY = 'magnetTask'

/** 日志 */
const logger = appLogger.sub('Magnet')

/**
 * 设置磁力链接任务
 * @param magnet 磁力链接
 */
export function setMagnetTask(magnet: string) {
  sessionStorage.setItem(MAGNET_TASK_KEY, magnet)
}

/**
 * 获取磁力链接任务
 * @returns 磁力链接
 */
export function getMagnetTask() {
  return sessionStorage.getItem(MAGNET_TASK_KEY)
}

/**
 * 移除磁力链接任务
 */
export function removeMagnetTask() {
  sessionStorage.removeItem(MAGNET_TASK_KEY)
}

/**
 * 注册磁力链接任务处理程序
 */
export function registerMagnetTaskHandler() {
  const magnetTask = getMagnetTask()
  if (magnetTask) {
    openOfflineTask(magnetTask)
    removeMagnetTask()
  }
}

/**
 * 注册磁力链接协议处理程序
 */
export function registerMagnetProtocolHandler() {
  /*
   * ================================================================================
   * 步骤1：注册磁力协议处理程序
   * ================================================================================
   * 目标：为支持该 API 的浏览器注册磁力链接入口，同时保证注册失败不影响主页面。
   * 数据源：当前页面 origin 与 navigator.registerProtocolHandler。
   * 操作：
   * 1) 生成同源、包含 %s 占位符的中转地址
   * 2) 捕获浏览器拒绝注册时抛出的 SecurityError
   */
  logger.info('开始注册磁力协议处理程序')

  if (!navigator.registerProtocolHandler) {
    logger.warn('此浏览器不支持注册协议处理程序')
    logger.info('磁力协议处理程序注册步骤结束')
    return false
  }

  try {
    /** 1.1 生成同源协议中转地址，避免 115Browser 拒绝相对 URL */
    const handlerUrl = new URL(
      '/web/lixian/master/magnet/?url=%s',
      window.location.origin,
    ).href

    // 1.2 请求浏览器注册磁力协议
    navigator.registerProtocolHandler(
      'magnet',
      handlerUrl,
    )
    logger.info('磁力协议处理程序注册完成')
    return true
  }
  catch (error) {
    // 1.3 浏览器策略拒绝时保留其余脚本功能
    logger.warn('当前浏览器拒绝磁力协议注册，继续启动页面功能', error)
    logger.info('磁力协议处理程序注册步骤结束')
    return false
  }
}

/**
 * 处理打开离线任务页面后
 */
export function handleOpenAfter() {
  if (window.history.length > 1) {
    window.history.back()
  }
  else {
    window.close()
  }
}

/**
 * 磁力链接页中转
 */
export function magnetPage() {
  const url = new URL(window.location.href)
  const magnet = url.searchParams.get('url')
  if (!magnet) {
    return
  }
  setMagnetTask(magnet)
  const handle = window.open(
    `/web/lixian/master/#/?offline_url=${magnet}`,
    '_blank',
    'width=1280,height=860',
  )
  if (handle) {
    handleOpenAfter()
  }
  else {
    alert('请设置允许弹出窗口并刷新页面，否则无法打开离线任务页面')
  }
}
