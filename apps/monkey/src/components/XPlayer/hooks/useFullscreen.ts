import type { PlayerContext } from './usePlayerProvide'
import { useEventListener } from '@vueuse/core'
import { shallowRef } from 'vue'

/**
 * 全屏、剧院模式和播放列表
 */
export function useFullscreen(ctx: PlayerContext) {
  /** 日志 */
  const logger = ctx.logger.sub('useFullscreen')
  /** 显示播放列表 */
  const showPlaylist = ctx.rootPropsVm.showPlaylist
  /** 剧院模式 */
  const theatre = ctx.rootPropsVm.theatre
  /** 是否全屏 */
  const isFullscreen = shallowRef(false)
  /** 全屏前播放列表状态 */
  const prevShowPlaylist = shallowRef(false)
  /** 监听全屏变化 */
  const handleFullscreenChange = () => {
    isFullscreen.value = !!document.fullscreenElement
  }

  /** 全屏控制 */
  const toggleFullscreen = async () => {
    ctx.controls.lockControlsWithTimeoutUnlock()
    try {
      // 请求全屏
      if (!document.fullscreenElement) {
        window.scrollTo(0, 0)
        await document.documentElement.requestFullscreen()
        prevShowPlaylist.value = showPlaylist.value
        if (showPlaylist.value) {
          showPlaylist.value = false
        }
      }
      // 退出全屏
      else {
        await document.exitFullscreen()
        if (prevShowPlaylist.value) {
          showPlaylist.value = true
        }
      }
    }
    catch (error) {
      logger.error('切换全屏失败:', error)
    }
  }

  /** 播放列表 */
  const toggleShowSider = async () => {
    const newValue = !showPlaylist.value
    showPlaylist.value = newValue
  }

  /** 剧院模式 */
  const toggleTheatre = async () => {
    /*
     * ================================================================================
     * 步骤1：切换剧院布局
     * ================================================================================
     * 目标：恢复旧版全宽剧院模式，并避免与系统全屏、画中画冲突。
     * 操作：
     * 1) 进入剧院模式前退出系统全屏
     * 2) 关闭画中画并持久化新的布局状态
     */
    logger.info('开始切换剧院模式', theatre.value)

    try {
      const enabled = !theatre.value
      if (enabled && document.fullscreenElement)
        await toggleFullscreen()
      if (ctx.pictureInPicture?.isPip.value)
        await ctx.pictureInPicture.close()
      theatre.value = enabled
    }
    catch (error) {
      logger.error('切换剧院模式失败:', error)
    }

    logger.info('剧院模式切换完成', theatre.value)
  }

  useEventListener(document, 'fullscreenchange', handleFullscreenChange)
  useEventListener(document, 'webkitfullscreenchange', handleFullscreenChange)
  useEventListener(document, 'mozfullscreenchange', handleFullscreenChange)
  useEventListener(document, 'MSFullscreenChange', handleFullscreenChange)

  return {
    showPlaylist,
    theatre,
    isFullscreen,
    toggleFullscreen,
    toggleShowSider,
    toggleTheatre,
  }
}
