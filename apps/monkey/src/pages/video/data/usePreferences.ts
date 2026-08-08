import type { ShortcutsPreference } from '@/components/XPlayer/components/Shortcuts/shortcuts.types'
import { useStorage } from '@vueuse/core'
import { merge } from 'lodash'

/** 用户偏好设置类型 */
export interface PlayerPreferences {
  /** 音量 */
  volume: number
  /** 静音 */
  muted: boolean
  /** 播放速率 */
  playbackRate: number
  /** 显示播放列表 */
  showPlaylist: boolean
  /** 剧院模式 */
  theatre: boolean
  /** 自动加载缩略图 */
  autoLoadThumbnails: boolean
  /** 禁用HDR */
  disabledHDR: boolean
  /** 缩略图最大采样间隔 */
  thumbnailsSamplingInterval: number
  /** 自动播放 */
  autoPlay: boolean
  /** 默认画质 */
  quality: number
  /** 快捷键偏好 */
  shortcutsPreference: ShortcutsPreference
  /** 长按倍速 */
  longPressPlaybackRate: number
  /** 快进 / 后退 */
  seekSeconds: number
  /** 高速快进 / 后退 */
  highSpeedSeekSeconds: number
  /** 百分比快进 / 后退 */
  percentageSeek: number
}

/** 默认偏好设置 */
const DEFAULT_PREFERENCES: PlayerPreferences = {
  volume: 100,
  muted: true,
  playbackRate: 1,
  showPlaylist: false,
  theatre: false,
  autoLoadThumbnails: true,
  disabledHDR: false,
  thumbnailsSamplingInterval: 60,
  autoPlay: true,
  shortcutsPreference: {
    actionKeyBindings: {},
  },
  quality: 0,
  longPressPlaybackRate: 3,
  seekSeconds: 5,
  highSpeedSeekSeconds: 30,
  percentageSeek: 10,
}

/**
 * 用户偏好设置
 */
export function usePreferences() {
  const preferences = useStorage<PlayerPreferences>(
    'x-player-preferences',
    DEFAULT_PREFERENCES,
    undefined,
    {
      listenToStorageChanges: false,
      mergeDefaults: (storage, defaults) => {
        // deep merge
        return merge(defaults, storage)
      },
    },
  )

  return preferences
}
