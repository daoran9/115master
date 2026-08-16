import type { PlayerContext } from '../usePlayerProvide'
import type { Subtitle } from '@/components/XPlayer/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useSubtitles } from '../useSubtitles'

const scopes: ReturnType<typeof effectScope>[] = []

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
})

function createSubtitle(id: string, isDefault = false): Subtitle {
  return {
    id,
    url: `https://subs.test/${id}.srt`,
    format: 'srt',
    label: id,
    srclang: 'zh-CN',
    kind: 'subtitles',
    default: isDefault,
  }
}

function setup() {
  const subtitles = ref<Subtitle[] | null>(null)
  const logger = {
    info: vi.fn(),
  }
  const ctx = {
    logger,
    rootProps: {
      subtitles,
      subtitlesLoading: ref(false),
      subtitlesReady: ref(true),
      onSubtitleChange: vi.fn(),
    },
  } as unknown as PlayerContext
  const scope = effectScope()
  const state = scope.run(() => useSubtitles(ctx))!
  scopes.push(scope)
  return { logger, state, subtitles }
}

describe('useSubtitles', () => {
  it('首次加载没有历史偏好时自动启用 No.1', async () => {
    /**
     * ============================================================================
     * 步骤1：加载无默认标记的字幕列表
     * ============================================================================
     * 目标：确认排序后的首条字幕自动成为当前字幕。
     * 数据源：两条无 default 标记的字幕 fixture。
     * 操作：
     * 1) 写入字幕列表。
     * 2) 等待 watcher 完成并核对当前字幕。
     */
    const { logger, state, subtitles } = setup()
    logger.info('开始验证字幕 No.1 自动选择')

    /** 1.1 写入排序后的字幕列表 */
    subtitles.value = [createSubtitle('first'), createSubtitle('second')]
    await nextTick()

    /** 1.2 核对当前字幕 */
    expect(state.current.value?.id).toBe('first')
    logger.info('字幕 No.1 自动选择验证完成')
  })

  it('首次加载优先启用 default 字幕', async () => {
    const { logger, state, subtitles } = setup()
    logger.info('开始验证 default 字幕优先级')

    /** 1.1 写入带 default 标记的字幕列表 */
    subtitles.value = [createSubtitle('first'), createSubtitle('preferred', true)]
    await nextTick()

    /** 1.2 核对 default 字幕优先于 No.1 */
    expect(state.current.value?.id).toBe('preferred')
    logger.info('default 字幕优先级验证完成')
  })

  it('空字幕列表保持关闭', async () => {
    const { logger, state, subtitles } = setup()
    logger.info('开始验证空字幕列表')

    /** 1.1 写入空字幕列表 */
    subtitles.value = []
    await nextTick()

    /** 1.2 核对播放器没有当前字幕 */
    expect(state.current.value).toBeNull()
    logger.info('空字幕列表验证完成')
  })

  it('字幕列表刷新后保留用户明确选择和关闭状态', async () => {
    const { logger, state, subtitles } = setup()
    logger.info('开始验证字幕明确偏好恢复')

    /** 1.1 用户选择 No.2，刷新后的新对象仍按 id 恢复 */
    const firstList = [createSubtitle('first'), createSubtitle('second')]
    subtitles.value = firstList
    await nextTick()
    state.change(firstList[1])
    subtitles.value = [createSubtitle('second'), createSubtitle('first')]
    await nextTick()
    expect(state.current.value?.id).toBe('second')

    /** 1.2 用户明确关闭后，后续列表刷新保持关闭 */
    state.change(null)
    subtitles.value = [createSubtitle('first'), createSubtitle('second')]
    await nextTick()
    expect(state.current.value).toBeNull()
    logger.info('字幕明确偏好恢复验证完成')
  })
})
