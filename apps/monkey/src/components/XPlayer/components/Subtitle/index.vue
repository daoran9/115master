<template>
  <div
    v-if="subtitles.current.value"
    :class="styles.container"
    data-xplayer-subtitle-track
    :data-subtitle-id="subtitles.current.value.id"
    :data-cue-count="subtitleParsed.length"
    :data-current-time="currentTime"
    :data-current-cue-start="currentSubtitle?.start"
    :data-current-cue-end="currentSubtitle?.end"
  >
    <div
      v-if="currentSubtitle"
      :class="styles.content"
      :style="{
        fontSize,
        transform: `translate(-50%, calc(0px - ${safeAreaBottom}))`,
      }"
    >
      {{ cleanedText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Subtitle } from '@/components/XPlayer/types'
import { subtitle } from '@115master/utils'
import { useElementBounding } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'
import { usePlayerContext } from '@/components/XPlayer/hooks/usePlayerProvide'
import { clsx } from '@/utils/clsx'

const styles = clsx({
  container: 'absolute inset-0',
  content: [
    'absolute bottom-[3%] left-1/2 mx-auto max-w-[80%] px-6',
    'bg-black/60 text-center whitespace-pre-wrap text-white',
    'transition-transform duration-200 ease-[var(--ui-ease-move)]',
    'rounded-xl',
  ],
})

const { subtitles, cssVar, refs, playerCore, logger } = usePlayerContext()
/** 安全区域底部 */
const safeAreaBottom = computed(() => cssVar?.safeAreaBottom.value)
/** 当前字幕 */
const current = computed(() => subtitles.current.value)
/** 播放器当前时间 */
const currentTime = computed(() => playerCore.value?.currentTime ?? 0)
/** 视频元素的边界 */
const playerElementBounding = useElementBounding(refs.playerElementRef)
/** 字幕字体大小 */
const fontSize = computed(
  () => `${playerElementBounding.height.value * 0.044}px`,
)
/**
 * 解析后的字幕
 */
const subtitleParsed = shallowRef<
  {
    start: string
    end: string
    text: string
    st: number
    et: number
  }[]
>([])
/** 字幕加载序号，用于丢弃较慢的旧请求 */
let loadSequence = 0
/**
 * 当前字幕
 */
const currentSubtitle = computed(() => {
  return subtitleParsed.value.find((subtitle) => {
    return (
      subtitle.st <= currentTime.value
      && subtitle.et >= currentTime.value
    )
  })
})
/** 清理后的字幕文本 */
const cleanedText = computed(() => {
  return currentSubtitle.value?.text.replace(/<[^>]*>?/g, '')
})

/**
 * 将时间转换为秒
 * @param time 时间字符串, 格式为 HH:MM:SS.MS
 * @returns 秒
 */
function timeToSeconds(time: string) {
  const match = time.trim().match(
    /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/,
  )
  if (!match)
    return Number.NaN

  const [, hours = '0', minutes = '0', seconds = '0', fraction = '0'] = match
  const milliseconds = Number(fraction.padEnd(3, '0'))

  return (
    Number(hours) * 3600
    + Number(minutes) * 60
    + Number(seconds)
    + milliseconds / 1000
  )
}

/**
 * 解析字幕VTT格式
 * @param text 字幕文本
 */
function parseSubtitleVTT(text: string) {
  const normalizedText = text.replace(/\r\n?/g, '\n')
  const blocks = normalizedText
    .split(/\n\s*\n/)
    .filter(block => block.trim() !== '')
  const subtitles: typeof subtitleParsed.value = []
  for (const block of blocks) {
    if (/WEBVTT/.test(block))
      continue

    const lines = block.split(/\n/)
    const timeIndex = lines.findIndex(line => line.includes('-->'))
    if (timeIndex < 0)
      continue

    /** 时间行之前允许存在 VTT cue 标识，之后均视为字幕文本 */
    const time = lines[timeIndex] ?? ''
    const text = lines.slice(timeIndex + 1).join('\n')

    const [start, end] = time.split('-->')
    if (!start || !end)
      continue

    const normalizedStart = start.trim()
    const normalizedEnd = end.trim().split(/\s+/)[0] ?? ''
    const st = timeToSeconds(normalizedStart)
    const et = timeToSeconds(normalizedEnd)
    if (!Number.isFinite(st) || !Number.isFinite(et) || et < st)
      continue

    subtitles.push({
      start: normalizedStart,
      end: normalizedEnd,
      text,
      st,
      et,
    })
  }
  return subtitles
}

/**
 * 解析字幕
 * @param text 字幕文本
 */
function parseSubtitle(text: string, format: Subtitle['format']) {
  let formatedText: string | undefined
  switch (format) {
    case 'srt':
      formatedText = subtitle.srtToVtt(text)
      break
    case 'vtt':
      formatedText = text
      break
    default:
      logger.warn('不支持的字幕格式:', format)
      return []
  }
  if (!formatedText)
    return []
  return parseSubtitleVTT(formatedText)
}

function fetchSubtitle(url: string) {
  return fetch(url)
    .then(response => response.blob())
}

/**
 * 加载字幕
 * @param subtitle 字幕
 */
async function loadSubtitle(subtitle: Subtitle | null) {
  /**
   * ================================================================================
   * 步骤1：加载当前选中的字幕
   * ================================================================================
   * 目标：只显示最后一次选择的字幕，避免较慢的旧请求覆盖当前字幕。
   * 数据源：当前字幕的 Blob 或远程 URL。
   * 操作：
   * 1) 递增加载序号并清空上一条字幕轨。
   * 2) 读取、解析字幕，并在写入前校验序号和当前选项。
   */
  const sequence = ++loadSequence
  subtitleParsed.value = []

  if (!subtitle) {
    logger.info('字幕已关闭')
    return
  }

  logger.info('开始加载字幕', subtitle.id)

  try {
    /** 1.1 读取当前字幕文本 */
    let subtitleText: string
    if (subtitle.raw) {
      subtitleText = await subtitle.raw.text()
    }
    else if (subtitle.url) {
      subtitleText = await (await fetchSubtitle(subtitle.url)).text()
    }
    else {
      logger.error('字幕数据无有效内容')
      return
    }

    /** 1.2 解析字幕，并丢弃已过期的异步结果 */
    const parsed = parseSubtitle(subtitleText, subtitle.format)
    if (sequence !== loadSequence || current.value?.id !== subtitle.id) {
      logger.info('字幕加载结果已过期', subtitle.id)
      return
    }

    subtitleParsed.value = parsed
    logger.info('字幕加载完成', subtitle.id, parsed.length)
  }
  catch (e) {
    if (sequence === loadSequence)
      logger.error('请求字幕文件失败', e)
  }
}

watch(current, subtitle => void loadSubtitle(subtitle), { immediate: true })
</script>
