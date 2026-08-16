import type { PlayingVideoInfo } from '@/types/player'
import { GM_openInTab, GM_setValue } from '$'
import { Share } from '@115master/drive115'

import GM_VALUE_KEY from '@/constants/gm.value.key'
import { appLogger } from '@/utils/logger'

const logger = appLogger.sub('Route')

/**
 * 跳转播放器
 * @param playingVideoInfo 播放中的视频信息
 * @param isOpenInTab 是否在新的标签页中打开
 */
export async function goToPlayer(playingVideoInfo: PlayingVideoInfo, isOpenInTab = false) {
  GM_setValue(GM_VALUE_KEY.PLAYING_VIDEO_INFO, playingVideoInfo)

  const url = `https://${Share.CONSTANT.HOST_115.NORMAL}/web/lixian/master/#/video/${playingVideoInfo.pickCode}`
  if (isOpenInTab) {
    GM_openInTab(url, {
      active: true,
    })
    return
  }

  /*
   * ================================================================================
   * 步骤1：在 MASTER 应用内切换播放器
   * ================================================================================
   * 目标：只在需要站内导航时加载 Hash Router，官方新版页面不产生 URL 副作用。
   * 数据源：当前播放文件 pickCode。
   * 操作：
   * 1) 按需加载 MASTER Router
   * 2) 替换为目标播放器路由
   */
  logger.info('开始加载 MASTER 播放路由', playingVideoInfo.pickCode)

  const { router } = await import('@/app/router')
  await router.replace({
    name: 'video',
    params: {
      pickCode: playingVideoInfo.pickCode,
    },
  })

  logger.info('MASTER 播放路由加载完成', playingVideoInfo.pickCode)
}

/**
 * 是否是用户手动刷新页面
 */
export function isReload(): boolean {
  return (
    top?.window.performance.navigation.type
    === top?.window.performance.navigation.TYPE_RELOAD
  )
}
