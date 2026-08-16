import type { Api } from '@115master/drive115'
import { appLogger } from '@/utils/logger'

type DownloadResult = Api.VideoApi.Model.DownloadResult
const logger = appLogger.sub('WebLink')

/**
 * 使用 shortcuts 打开 mpv 播放网页
 */
export function webLinkShortcutsMpv(downloadResult: DownloadResult) {
  const shell = {
    bin: '/opt/homebrew/bin/mpv',
    url: downloadResult.url.url,
    userAgent: navigator.userAgent,
  }
  return `shortcuts://run-shortcut?name=115MasterWebLink&input=text&text=${encodeURIComponent(
    JSON.stringify(shell),
  )}`
}

/** Windows MPV 本地协议，由 scripts/windows-mpv 安装当前用户协议处理器。 */
export const WINDOWS_MPV_PROTOCOL = 'master115-mpv'

/**
 * 生成 Windows MPV 本地协议链接。
 *
 * 链接只携带当前视频临时下载地址和请求头，不执行任意命令。
 */
export function webLinkWindowsMpv(downloadResult: DownloadResult) {
  /*
   * ================================================================================
   * 步骤1：生成 Windows MPV 协议参数
   * ================================================================================
   * 目标：让本地协议处理器用与网页播放器一致的鉴权信息打开视频。
   * 数据源：115 文件下载地址、User-Agent 和 auth_cookie。
   * 操作：
   * 1) 只序列化固定字段
   * 2) 返回 master115-mpv://play 链接
   */
  logger.info('开始生成 Windows MPV 协议链接')

  const params = new URLSearchParams({
    url: downloadResult.url.url,
    userAgent: navigator.userAgent,
  })
  const authCookie = downloadResult.url.auth_cookie
  if (authCookie?.name && authCookie.value)
    params.set('cookie', `${authCookie.name}=${authCookie.value}`)

  const link = `${WINDOWS_MPV_PROTOCOL}://play?${params.toString()}`
  logger.info('Windows MPV 协议链接生成完成')
  return link
}

/**
 * 使用 iina 打开网页
 */
export function webLinkIINA(downloadResult: DownloadResult) {
  return `iina://weblink?url=${encodeURIComponent(downloadResult.url.url)}&mpv_http-header-fields=${encodeURIComponent(
    `User-Agent: ${navigator.userAgent.replace(',', '\\,')},Cookie: ${downloadResult.url.auth_cookie?.name}=${downloadResult.url.auth_cookie?.value}`,
  )}`
}
