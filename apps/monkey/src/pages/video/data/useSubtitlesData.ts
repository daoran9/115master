import type { ProcessedSubtitle } from '@115master/subtitle-source'
import type { Subtitle } from '@/components/XPlayer/types'
import { FetchRequest } from '@115master/shared'
import { subtitleSource } from '@115master/subtitle-source'
import { string } from '@115master/utils'
import { useAsyncState } from '@vueuse/core'
import { shallowRef } from 'vue'
import { subtitleCache } from '@/utils/cache/subtitleCache'
import { subtitlePreference } from '@/utils/cache/subtitlePreference'
import { drive115 } from '@/utils/drive115Instance'
import { getAvNumber } from '@/utils/getNumber'
import { appLogger } from '@/utils/logger'
import { GMRequestInstance } from '@/utils/request/gmRequest'
import { rankSubtitlesByRelevance } from './subtitleRanking'

/* eslint-disable jsdoc/convert-to-jsdoc-comments */

const fetchRequest = new FetchRequest()
const logger = appLogger.sub('SubtitlesData')

const subtitlecat = new subtitleSource.SubtitleCat({
  request: GMRequestInstance,
  extractAvNumber: getAvNumber,
})

const thunder = new subtitleSource.Thunder({
  request: GMRequestInstance,
  extractAvNumber: getAvNumber,
})

const avsubtitles = new subtitleSource.AvSubtitles({
  request: GMRequestInstance,
  extractAvNumber: getAvNumber,
})

const aiyi = new subtitleSource.Aiyi({
  request: GMRequestInstance,
  extractAvNumber: getAvNumber,
})

/** 字幕数据 */
export function useDataSubtitles() {
  const currentId = shallowRef<string>()

  const toSubtitle = (
    subtitle: ProcessedSubtitle,
    source = subtitle.source ?? 'Subtitle Cat',
  ): Subtitle => ({
    id: subtitle.id,
    label: subtitle.title,
    srclang: subtitle.targetLanguage,
    source,
    raw: subtitle.raw,
    format: subtitle.format,
    kind: 'subtitles' as const,
    avNumber: subtitle.avNumber,
    sourceScore: subtitle.comment * 100 + Math.log10(subtitle.downloads + 1),
  })

  const getCached = async (
    source: string,
    keyword: string,
    fetcher: () => Promise<ProcessedSubtitle[]>,
  ): Promise<Subtitle[]> => {
    /*
     * ================================================================================
     * 步骤1：读取外部字幕来源
     * ================================================================================
     * 目标：按来源隔离缓存，避免同一番号在多个站点互相覆盖。
     * 数据源：来源名、标准番号和来源客户端。
     * 操作：
     * 1) 优先读取七天缓存
     * 2) 联网成功后缓存完整可播放字幕
     */
    logger.info('开始读取外部字幕来源', source, keyword)

    // 1.1 缓存键包含来源名，保留各站独立结果。
    const key = `${source}:${keyword}`
    const cached = await subtitleCache.getCache(key, 'zh-CN')
    if (cached) {
      const result = cached.map(subtitle => toSubtitle(subtitle, source))
      logger.info('外部字幕来源读取完成，命中缓存', source, result.length)
      return result
    }

    // 1.2 只缓存已经下载并能交给播放器的结果。
    const subtitles = await fetcher()
    if (subtitles.length > 0)
      await subtitleCache.addCache(key, 'zh-CN', subtitles.map(subtitle => ({ ...subtitle })))
    const result = subtitles.map(subtitle => toSubtitle(subtitle, source))
    logger.info('外部字幕来源读取完成', source, result.length)
    return result
  }

  /** 通过 subtitleCat 获取字幕 */
  const getFromSubtitlecat = async (keyword: string): Promise<Subtitle[]> => {
    if (!keyword)
      return []
    return getCached(
      'Subtitle Cat',
      keyword,
      () => subtitlecat.fetchSubtitle(keyword, 'zh-CN'),
    )
  }

  /** 通过 AVSubtitles 获取精确番号字幕。 */
  const getFromAvSubtitles = async (keyword: string): Promise<Subtitle[]> => {
    if (!keyword)
      return []
    return getCached(
      'AVSubtitles',
      keyword,
      () => avsubtitles.fetchSubtitle(keyword, 'zh-CN'),
    )
  }

  /** 通过爱译网获取精确番号字幕。 */
  const getFromAiyi = async (keyword: string): Promise<Subtitle[]> => {
    if (!keyword)
      return []
    return getCached(
      '爱译网',
      keyword,
      () => aiyi.fetchSubtitle(keyword, 'zh-CN'),
    )
  }

  /** 通过迅雷获取字幕 */
  const getFromThunder = async (filename: string): Promise<Subtitle[]> => {
    if (!filename) {
      return []
    }
    const res = await thunder.fetchSubtitle(filename)
    const subtitles = res.map(subtitle => ({
      id: subtitle.id,
      label: string.removeFileExtension(subtitle.title),
      srclang: 'zh-CN',
      source: 'Thunder',
      raw: subtitle.raw,
      format: subtitle.format,
      kind: 'subtitles' as const,
      durationMs: subtitle.durationMs,
      sourceScore: subtitle.score,
      fingerprintScore: subtitle.fingerprintScore,
      avNumber: subtitle.avNumber,
    } satisfies Subtitle))
    return subtitles
  }

  /** 通过 115 获取字幕 */
  const getFrom115 = async (pickcode: string): Promise<Subtitle[]> => {
    const res = await drive115.file.getMoviesSubtitle({
      pickcode,
    })
    const results = await Promise.allSettled(
      res.data.list.map(async (subtitle) => {
        const url = new URL(subtitle.url)
        url.protocol = 'https://'
        const res = await fetchRequest.get(url.href)
        const blob = await res.blob()
        return {
          id: subtitle.sid,
          url: url.href,
          raw: blob,
          label: `${string.removeFileExtension(subtitle.title)}`,
          source: subtitle.file_id ? 'Upload' : 'Built-in',
          srclang: subtitle.language || 'zh-CN',
          format: subtitle.type,
          kind: 'subtitles' as const,
          trustedForVideo: true,
        } satisfies Subtitle
      }),
    )
    return results
      .filter(result => result.status === 'fulfilled')
      .map(result => (result as PromiseFulfilledResult<Subtitle>).value)
  }

  /** 字幕数据 */
  const subtitles = useAsyncState<Subtitle[]>(
    async (
      pickcode: string,
      filename: string,
      keyword: string,
      videoDurationSeconds?: number,
    ): Promise<Subtitle[]> => {
      currentId.value = pickcode
      const preference = await subtitlePreference.getPreference(pickcode)
      if (currentId.value !== pickcode) {
        return []
      }
      /** 并行获取所有来源的字幕 */
      const results = await Promise.allSettled([
        getFromSubtitlecat(keyword),
        getFromThunder(filename),
        getFromAvSubtitles(keyword),
        getFromAiyi(keyword),
        getFrom115(pickcode),
      ])

      if (currentId.value !== pickcode) {
        return []
      }

      const subtitles = results
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<Subtitle[]>).value)
        .flat()
      const rankedSubtitles = rankSubtitlesByRelevance(
        subtitles,
        filename,
        keyword,
        videoDurationSeconds,
      )

      return rankedSubtitles
        .map(subtitle => ({
          ...subtitle,
          default: preference ? preference.id === subtitle.id : false,
        }))
    },
    [],
    {
      immediate: false,
    },
  )

  const clear = () => {
    subtitles.execute(0, '')
    currentId.value = undefined
  }

  return {
    ...subtitles,
    clear,
  }
}
