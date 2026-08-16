import type { Subtitle } from '@/components/XPlayer/types'
import { array, string } from '@115master/utils'
import { getAvNumber } from '@/utils/getNumber'
import { appLogger } from '@/utils/logger'

/* eslint-disable jsdoc/convert-to-jsdoc-comments */

const logger = appLogger.sub('SubtitleRanking')

export type RankedSubtitle = Subtitle & {
  similarity: number
}

interface SubtitleRank {
  durationDeltaMs: number | null
  exactAvMatch: boolean
  index: number
  identityRank: number
  similarity: number
  subtitle: Subtitle
}

function normalizeAvIdentity(value?: string | null) {
  return (value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function computeSimilarity(label: string, filename: string) {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase()
  return array.jaccardSimilarity(
    string.splitWords(normalize(label)),
    string.splitWords(normalize(filename)),
  )
}

/**
 * ================================================================================
 * 步骤1：计算字幕与当前视频的相关度
 * ================================================================================
 * 目标：让同番号字幕优先于标题相似但属于其他视频的字幕。
 * 数据源：当前视频文件名、已识别番号和全部字幕名称。
 * 操作：
 * 1) 统一番号的大小写与分隔符
 * 2) 同时计算番号命中状态和文件名相似度
 */
export function rankSubtitlesByRelevance(
  subtitles: Subtitle[],
  filename: string,
  avNumber?: string | null,
  videoDurationSeconds?: number | null,
): RankedSubtitle[] {
  logger.info('开始计算字幕相关度', {
    avNumber,
    subtitleCount: subtitles.length,
    videoDurationSeconds,
  })

  // 1.1 生成可跨连字符、下划线和空格比较的番号标识。
  const avIdentity = normalizeAvIdentity(avNumber)
  const canMatchAvNumber = avIdentity.length >= 4

  // 1.2 为每条字幕记录番号命中、相似度和原始位置。
  const videoDurationMs = Number.isFinite(videoDurationSeconds)
    ? Number(videoDurationSeconds) * 1000
    : null
  const ranks: SubtitleRank[] = subtitles.map((subtitle, index) => {
    const subtitleDurationMs = subtitle.durationMs
    const candidateAvIdentity = normalizeAvIdentity(
      subtitle.avNumber ?? getAvNumber(subtitle.label),
    )
    const exactAvMatch
      = canMatchAvNumber && candidateAvIdentity === avIdentity
    const conflict
      = canMatchAvNumber
        && candidateAvIdentity.length >= 4
        && candidateAvIdentity !== avIdentity
        && !subtitle.trustedForVideo
    return {
      durationDeltaMs:
        videoDurationMs !== null && Number.isFinite(subtitleDurationMs)
          ? Math.abs(videoDurationMs - Number(subtitleDurationMs))
          : null,
      exactAvMatch,
      index,
      identityRank: conflict
        ? 0
        : subtitle.trustedForVideo || exactAvMatch
          ? 2
          : 1,
      similarity: computeSimilarity(subtitle.label, filename),
      subtitle,
    }
  }).filter(rank => rank.identityRank > 0)
  logger.info('字幕相关度计算完成', {
    exactMatchCount: ranks.filter(rank => rank.exactAvMatch).length,
    rejectedConflictCount: subtitles.length - ranks.length,
    subtitleCount: ranks.length,
  })

  /*
   * ================================================================================
   * 步骤2：按相关度生成播放器字幕顺序
   * ================================================================================
   * 目标：先展示同番号字幕，再展示其他候选字幕。
   * 数据源：步骤1生成的字幕相关度。
   * 操作：
   * 1) 番号命中优先，再比较视频时长和文件名相似度
   * 2) 同分时比较来源质量分，最后保留原始顺序
   */
  logger.info('开始排序播放器字幕', {
    subtitleCount: ranks.length,
  })

  // 2.1 按番号、视频时长、相似度、来源质量和原始位置排序。
  ranks.sort((a, b) => {
    if (a.identityRank !== b.identityRank)
      return b.identityRank - a.identityRank
    if (a.durationDeltaMs !== null && b.durationDeltaMs !== null) {
      if (a.durationDeltaMs !== b.durationDeltaMs)
        return a.durationDeltaMs - b.durationDeltaMs
    }
    else if (a.durationDeltaMs !== b.durationDeltaMs) {
      return a.durationDeltaMs === null ? 1 : -1
    }
    if (a.similarity !== b.similarity)
      return b.similarity - a.similarity
    if ((a.subtitle.fingerprintScore ?? 0) !== (b.subtitle.fingerprintScore ?? 0))
      return (b.subtitle.fingerprintScore ?? 0) - (a.subtitle.fingerprintScore ?? 0)
    if ((a.subtitle.sourceScore ?? 0) !== (b.subtitle.sourceScore ?? 0))
      return (b.subtitle.sourceScore ?? 0) - (a.subtitle.sourceScore ?? 0)
    return a.index - b.index
  })

  // 2.2 只把播放器需要的字幕字段和相似度传给后续流程。
  const rankedSubtitles = ranks.map(({ similarity, subtitle }) => ({
    ...subtitle,
    similarity,
  }))
  logger.info('播放器字幕排序完成', {
    firstSubtitle: rankedSubtitles[0]?.label ?? null,
    subtitleCount: rankedSubtitles.length,
  })

  return rankedSubtitles
}
