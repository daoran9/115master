import type { PlayerContext } from './usePlayerProvide'
import type { Subtitle } from '@/components/XPlayer/types'
import { computed, ref, watch } from 'vue'

/**
 * 字幕
 */
export function useSubtitles(ctx: PlayerContext) {
  /** 当前字幕 */
  const current = ref<Subtitle | null>(null)

  /** 上一个字幕 */
  const previousSubtitle = ref<Subtitle | null>(null)

  /** 用户是否已经明确选择或关闭字幕 */
  let hasExplicitPreference = false

  /** 用户明确选择的字幕 id；null 表示明确关闭 */
  let preferredSubtitleId: string | null = null

  /** 默认字幕 */
  const defaultSubtitle = computed(() => {
    return (
      ctx.rootProps.subtitles.value?.find(s => s.default)
      ?? ctx.rootProps.subtitles.value?.[0]
      ?? null
    )
  })

  /** 当前字幕序号 */
  const currentIndex = computed(() => {
    if (!current.value || !ctx.rootProps.subtitles.value) {
      return null
    }
    const index = ctx.rootProps.subtitles.value.findIndex(
      sub => sub.id === current.value?.id,
    )
    return index !== -1 ? index + 1 : null
  })

  /** 字幕总数 */
  const total = computed(() => {
    return ctx.rootProps.subtitles.value?.length ?? 0
  })

  /** 是否有字幕 */
  const hasSubtitles = computed(() => {
    return total.value > 0
  })

  /** 切换字幕 */
  const change = (subtitle: Subtitle | null, init = false) => {
    if (!init) {
      hasExplicitPreference = true
      preferredSubtitleId = subtitle?.id ?? null
    }
    if (subtitle) {
      previousSubtitle.value = subtitle
    }
    current.value = subtitle
    if (!init) {
      ctx.rootProps.onSubtitleChange?.(subtitle)
    }
  }

  /** 导航字幕 */
  const navigate = (direction: 1 | -1) => {
    const subtitles = ctx.rootProps.subtitles.value
    if (!subtitles || subtitles.length === 0) {
      return
    }

    /** 如果当前没有字幕，选择边界字幕（下一个选第一个，上一个选最后一个） */
    if (!current.value) {
      const fallbackIndex = direction === 1 ? 0 : subtitles.length - 1
      change(subtitles[fallbackIndex])
      return
    }

    /** 查找当前字幕的索引 */
    const currentIdx = subtitles.findIndex(sub => sub.id === current.value?.id)
    if (currentIdx === -1) {
      /** 当前字幕不在列表中，选择边界字幕 */
      const fallbackIndex = direction === 1 ? 0 : subtitles.length - 1
      change(subtitles[fallbackIndex])
      return
    }

    /** 计算下一个索引 */
    const nextIdx = currentIdx + direction

    /** 检查边界，如果超出边界则关闭字幕 */
    if (nextIdx >= 0 && nextIdx < subtitles.length) {
      change(subtitles[nextIdx])
    }
    else {
      change(null)
    }
  }

  /** 切换到下一个字幕 */
  const next = () => navigate(1)

  /** 切换到上一个字幕 */
  const prev = () => navigate(-1)

  /** 切换字幕开关 */
  const toggleEnabled = () => {
    if (current.value) {
      change(null)
    }
    else if (previousSubtitle.value) {
      change(previousSubtitle.value)
    }
    else {
      change(defaultSubtitle.value ?? null)
    }
  }

  /** 设置默认字幕 */
  const restoreLastSubtitle = (subtitles: Subtitle[]) => {
    /**
     * ============================================================================
     * 步骤1：恢复当前字幕选择
     * ============================================================================
     * 目标：字幕异步刷新后保持用户选择；首次加载时自动启用排序后的第一条。
     * 数据源：播放器字幕列表、用户本次播放中的明确选择。
     * 操作：
     * 1) 有明确偏好时按字幕 id 恢复，明确关闭时保持关闭。
     * 2) 没有偏好时优先 default 标记，再回退到 No.1。
     */
    ctx.logger.info('开始恢复播放器字幕选择', subtitles.length)

    /** 1.1 优先恢复用户在本次播放中的明确选择 */
    if (hasExplicitPreference) {
      const preferredSubtitle = preferredSubtitleId === null
        ? null
        : subtitles.find(subtitle => subtitle.id === preferredSubtitleId) ?? null
      change(preferredSubtitle, true)
      ctx.logger.info('播放器字幕选择恢复完成', preferredSubtitle?.id ?? 'off')
      return
    }

    /** 1.2 首次加载优先 default 标记，否则自动启用排序后的 No.1 */
    const initialSubtitle = subtitles.find(subtitle => subtitle.default)
      ?? subtitles[0]
      ?? null
    change(initialSubtitle, true)
    ctx.logger.info('播放器字幕选择恢复完成', initialSubtitle?.id ?? 'off')
  }

  // 监听字幕列表变化，设置默认字幕
  watch(() => ctx.rootProps.subtitles.value, (newSubtitles) => {
    if (newSubtitles) {
      restoreLastSubtitle(newSubtitles)
    }
  })

  return {
    list: ctx.rootProps.subtitles,
    loading: ctx.rootProps.subtitlesLoading,
    ready: ctx.rootProps.subtitlesReady,
    current,
    currentIndex,
    total,
    hasSubtitles,
    change,
    toggleEnabled,
    next,
    prev,
  }
}
