// @vitest-environment jsdom

import type { PlayerContext } from '@/components/XPlayer/hooks/usePlayerProvide'
import type { Subtitle } from '@/components/XPlayer/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, ref, shallowRef } from 'vue'
import SubtitleView from '../index.vue'

const mocks = vi.hoisted(() => ({
  context: undefined as unknown as PlayerContext,
}))

vi.mock('@/components/XPlayer/hooks/usePlayerProvide', () => ({
  usePlayerContext: () => mocks.context,
}))

vi.mock('@vueuse/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...original,
    useElementBounding: () => ({ height: ref(100) }),
  }
})

const apps: ReturnType<typeof createApp>[] = []

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount())
})

function createSubtitle(id: string, text: () => Promise<string>): Subtitle {
  return {
    id,
    raw: { text } as Blob,
    format: 'srt',
    label: id,
    srclang: 'zh-CN',
    kind: 'subtitles',
  }
}

describe('subtitle', () => {
  it('cRLF 字幕可显示且较慢的旧字幕不会覆盖当前字幕', async () => {
    /**
     * ================================================================================
     * 步骤1：验证字幕解析和异步切轨
     * ================================================================================
     * 目标：CRLF 字幕正常显示，先发出的慢请求不能覆盖后选择的字幕。
     * 数据源：一条延迟返回的旧字幕和一条立即返回的 CRLF 新字幕。
     * 操作：
     * 1) 先加载旧字幕，再切换到新字幕。
     * 2) 等旧字幕返回后核对页面仍显示新字幕。
     */
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    let resolveSlow!: (value: string) => void
    const slowText = new Promise<string>((resolve) => {
      resolveSlow = resolve
    })
    const slow = createSubtitle('slow', () => slowText)
    const fast = createSubtitle(
      'fast',
      async () => '1\r\n00:00:01,000 --> 00:00:02,000\r\n新字幕\r\n',
    )
    const current = ref<Subtitle | null>(slow)
    const host = document.createElement('div')
    const context = {
      subtitles: { current },
      cssVar: { safeAreaBottom: ref('0px') },
      refs: { playerElementRef: shallowRef(document.createElement('div')) },
      playerCore: ref({ currentTime: 1.5 }),
      logger,
    } as unknown as PlayerContext

    logger.info('开始验证字幕解析和异步切轨')
    mocks.context = context
    const app = createApp(SubtitleView)
    app.mount(host)
    apps.push(app)

    /** 1.1 切换到立即返回的 CRLF 字幕 */
    current.value = fast
    await nextTick()
    await vi.waitFor(() => expect(host.textContent).toContain('新字幕'))

    /** 1.2 旧字幕最后返回，页面仍保持当前字幕 */
    resolveSlow('1\n00:00:01.000 --> 00:00:02.000\n旧字幕\n')
    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith('字幕加载结果已过期', 'slow')
    })
    expect(host.textContent).toContain('新字幕')
    expect(host.textContent).not.toContain('旧字幕')
    logger.info('字幕解析和异步切轨验证完成')
  })

  it('播放时间进入毫秒 cue 后显示字幕并在离开后隐藏', async () => {
    /**
     * ================================================================================
     * 步骤1：验证毫秒时间解析和播放推进
     * ================================================================================
     * 目标：保留三位毫秒精度，播放时间变化时字幕跟随出现和消失。
     * 数据源：开始时间为 37.100 秒的 SRT cue 和响应式播放器时间。
     * 操作：
     * 1) 从 cue 前推进到 cue 内，再推进到 cue 后。
     * 2) 核对字幕文本及只读诊断属性随时间同步变化。
     */
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const current = ref<Subtitle | null>(createSubtitle(
      'millisecond-cue',
      async () => '1\r\n00:00:37,100 --> 00:00:38,100\r\n毫秒字幕\r\n',
    ))
    const playerCore = ref({ currentTime: 37.05 })
    const host = document.createElement('div')
    const context = {
      subtitles: { current },
      cssVar: { safeAreaBottom: ref('0px') },
      refs: { playerElementRef: shallowRef(document.createElement('div')) },
      playerCore,
      logger,
    } as unknown as PlayerContext

    logger.info('开始验证毫秒时间解析和播放推进')
    mocks.context = context
    const app = createApp(SubtitleView)
    app.mount(host)
    apps.push(app)

    /** 1.1 字幕加载后，cue 前不显示文本 */
    await vi.waitFor(() => {
      expect(
        host.querySelector('[data-xplayer-subtitle-track]')
          ?.getAttribute('data-cue-count'),
      ).toBe('1')
    })
    expect(host.textContent).not.toContain('毫秒字幕')

    /** 1.2 推进到 cue 内，字幕文本和诊断时间同步更新 */
    playerCore.value.currentTime = 37.15
    await nextTick()
    expect(host.textContent).toContain('毫秒字幕')
    expect(
      host.querySelector('[data-xplayer-subtitle-track]')
        ?.getAttribute('data-current-cue-start'),
    ).toBe('00:00:37.100')

    /** 1.3 离开 cue 后字幕隐藏 */
    playerCore.value.currentTime = 38.101
    await nextTick()
    expect(host.textContent).not.toContain('毫秒字幕')
    logger.info('毫秒时间解析和播放推进验证完成')
  })
})
