import type { AVPlayerOptions } from '@libmedia/avplayer'
import type { HlsConfig } from 'hls.js'
import type { RequireAtLeastOne } from 'type-fest'
import type { Ref } from 'vue'
import type { ShortcutsExt, ShortcutsPreference } from '@/components/XPlayer/components/Shortcuts/shortcuts.types'
import type { PlayerContext } from '@/components/XPlayer/hooks/usePlayerProvide'
import type { VIDEO_SOURCE_EXTENSION } from '@/components/XPlayer/index.const'

/**
 * 缩略图帧
 */
export type ThumbnailFrame
  = | {
    /** 缩略图 */
    img: ImageBitmap
    /** 请求时间 */
    seekTime: number
    /** 经过模糊处理的时间 */
    seekBlurTime: number
    /** 帧实际时间 */
    frameTime: number
    /** 消耗时间 */
    consumedTime: number
  }
  | undefined

/**
 * 缩略图请求
 */
export type ThumbnailRequest = ({
  type,
  time,
  isLast,
}: {
  /** 类型 */
  type: 'Cache' | 'Must'
  /** 时间 */
  time: number
  /** 是否最后 */
  isLast: boolean
}) => Promise<ThumbnailFrame>

/**
 * 视频源
 */
export interface VideoSource {
  /** 名称 */
  name: string
  /** 地址 */
  url: string
  /** 海报 */
  poster?: string
  /** 类型 */
  /** 明确定义支持的类型 */
  type: 'auto' | 'hls'
  /** 扩展名 */
  extension:
    | string
    | (typeof VIDEO_SOURCE_EXTENSION)[keyof typeof VIDEO_SOURCE_EXTENSION]
  /** 质量 */
  quality: number
  /** 显示的画质值（可选） */
  displayQuality?: string | number
  /** hls 配置 */
  hlsConfig?: {
    // 其他配置
    [key: string]: unknown
    /** 自动开始加载 */
    autoStartLoad?: boolean
    /** 开始位置 */
    startPosition?: number
    /** 调试 */
    debug?: boolean
  }
}

/** 字幕 Base */
export interface SubtitleBase {
  /** 字幕 id */
  id: string
  /** 字幕网络地址或 BlobUrl */
  url?: string
  /** 字幕原始文本 */
  raw?: Blob
  /** 字幕格式 */
  format: 'srt' | 'vtt' | string
  /** 字幕名称 */
  label: string
  /** 字幕语言 */
  srclang: string
  /** 字幕类型 */
  kind: 'subtitles' | 'captions'
  /** 是否字幕默认 */
  default?: boolean
  /** 字幕来源 */
  source?: string
  /** 字幕来源 ICON */
  sourceIcon?: string
  /** 字幕对应的视频时长（毫秒） */
  durationMs?: number
  /** 来源质量分 */
  sourceScore?: number
  /** 来源指纹分 */
  fingerprintScore?: number
  /** 字幕标题中已核对的标准番号。 */
  avNumber?: string
  /** 来源接口已把字幕绑定到当前视频。 */
  trustedForVideo?: boolean
}

/** 字幕 */
export type Subtitle = RequireAtLeastOne<SubtitleBase, 'url' | 'raw'>

/**
 * 播放器属性
 */
export interface XPlayerProps {
  /** 视频源 */
  sources: Ref<VideoSource[]>
  /** 显示播放列表 */
  showPlaylist: boolean
  /** 剧院模式 */
  theatre: boolean
  /** 音量 */
  volume: number
  /** 静音 */
  muted: boolean
  /** 播放速率 (0.1-15) */
  playbackRate: number
  /** 字幕 */
  subtitles: Ref<Subtitle[] | null>
  /** 字幕准备就绪 */
  subtitlesReady: Ref<boolean>
  /** 字幕加载中 */
  subtitlesLoading: Ref<boolean>
  /** 上次播放时间 */
  lastTime?: number
  /** 自动缓冲缩略图 */
  autoLoadThumbnails: boolean
  /** 自动播放 */
  autoPlay: boolean
  /** 默认画质 */
  quality?: number
  /** 禁用HDR */
  disabledHDR: boolean
  /** 缩略图最大采样间隔 */
  thumbnailsSamplingInterval: number
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
  /** 是否有上一集 */
  hasPrevious?: boolean
  /** 是否有下一集 */
  hasNext?: boolean
  /** 外部快捷键配置 */
  shortcutsExt?: ShortcutsExt
  /** hls 配置 */
  hlsConfig?: Partial<HlsConfig>
  /** avPlayer 配置 */
  avPlayerConfig?: Partial<AVPlayerOptions>
  /** 播放列表数量 */
  playlistCount?: number
  /** 播放列表当前索引 (0-based) */
  playlistIndex?: number
  /** 缩略图请求 */
  onThumbnailRequest?: ThumbnailRequest
  /** 字幕改变 */
  onSubtitleChange?: (subtitle: Subtitle | null) => void
  /** 播放器可播放 */
  onCanplay?: (ctx: PlayerContext) => void
  /** 更新当前时间 */
  onTimeupdate?: (ctx: PlayerContext) => void
  /** 跳转中 */
  onSeeking?: (ctx: PlayerContext) => void
  /** 跳转结束 */
  onSeeked?: (ctx: PlayerContext) => void
  /** 播放结束 */
  onEnded?: (ctx: PlayerContext) => void
  /** 播放器错误 */
  onError?: (e: [ctx: PlayerContext, error: unknown]) => void
}

export interface XPlayerEmit {
  /** 播放列表 */
  'update:showPlaylist': [boolean]
  /** 剧院模式 */
  'update:theatre': [boolean]
  /** 音量 */
  'update:volume': [number]
  /** 静音 */
  'update:muted': [boolean]
  /** 播放速率 */
  'update:playbackRate': [number]
  /** 自动缓冲缩略图 */
  'update:autoLoadThumbnails': [boolean]
  /** 自动播放 */
  'update:autoPlay': [boolean]
  /** 默认画质 */
  'update:quality': [number]
  /** 禁用HDR */
  'update:disabledHDR': [boolean]
  /** 缩略图最大采样间隔 */
  'update:thumbnailsSamplingInterval': [number]
  /** 快捷键偏好 */
  'update:shortcutsPreference': [ShortcutsPreference]
  /** 长按倍速 */
  'update:longPressPlaybackRate': [number]
  /** 快进 / 后退 */
  'update:seekSeconds': [number]
  /** 高速快进 / 后退 */
  'update:highSpeedSeekSeconds': [number]
  /** 百分比快进 / 后退 */
  'update:percentageSeek': [number]
  /** 播放上一集 */
  'playPrevious': [PlayerContext]
  /** 播放下一集 */
  'playNext': [PlayerContext]
}
