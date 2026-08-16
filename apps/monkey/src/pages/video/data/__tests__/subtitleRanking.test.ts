import type { Subtitle } from '@/components/XPlayer/types'
import { describe, expect, it } from 'vitest'
import { rankSubtitlesByRelevance } from '../subtitleRanking'

function createSubtitle(
  id: string,
  label: string,
  durationMs?: number,
  extra: Partial<Subtitle> = {},
): Subtitle {
  return {
    id,
    format: 'srt',
    kind: 'subtitles',
    label,
    srclang: 'zh-CN',
    url: `https://subtitle.test/${id}.srt`,
    durationMs,
    ...extra,
  }
}

describe('rankSubtitlesByRelevance', () => {
  it('同番号字幕优先于无关的上传字幕', () => {
    const subtitles = [
      createSubtitle('unrelated', 'FTHTD-201.restored'),
      createSubtitle('related-upload', 'bf_304-uncensored.XLSUB'),
      createSubtitle('related-search', 'BF-304.zh'),
    ]

    const ranked = rankSubtitlesByRelevance(
      subtitles,
      'BF-304RQ～美脚の誘惑！中出しレースクィーン！～椎名ゆな_restored.mp4',
      'BF-304',
    )

    expect(ranked.map(subtitle => subtitle.id)).toEqual([
      'related-search',
      'related-upload',
    ])
  })

  it('番号分隔符和大小写不同仍视为同一视频', () => {
    const subtitles = [
      createSubtitle('other', 'SORA-636.zh'),
      createSubtitle('same', '[bf 304] 中文字幕'),
    ]

    const ranked = rankSubtitlesByRelevance(
      subtitles,
      'BF-304_restored.mp4',
      'bf-304',
    )

    expect(ranked[0]?.id).toBe('same')
  })

  it('没有番号时沿用文件名相似度并保持同分顺序', () => {
    const subtitles = [
      createSubtitle('first', '剧集 第01集.chs'),
      createSubtitle('second', '完全无关'),
      createSubtitle('third', '另一个字幕'),
    ]

    const ranked = rankSubtitlesByRelevance(
      subtitles,
      '剧集 第01集.mp4',
      null,
    )

    expect(ranked.map(subtitle => subtitle.id)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('同番号候选优先采用最接近当前视频时长的字幕', () => {
    const subtitles = [
      createSubtitle('similar-name', 'hhd800.com@NPJS-268.ja.简体中文', 7_784_000),
      createSubtitle('duration-match', 'NPJS-268', 7_800_000),
    ]

    const ranked = rankSubtitlesByRelevance(
      subtitles,
      'www.98T.la@NPJS-268.restored-M.mp4',
      'NPJS-268',
      7_800.747,
    )

    expect(ranked[0]?.id).toBe('duration-match')
  })

  it('相似番号不能用包含关系冒充精确命中', () => {
    const subtitles = [
      createSubtitle('conflict', 'JAC-0890.zh.srt'),
      createSubtitle('unknown', '中文字幕.srt'),
      createSubtitle('exact', 'JAC-089.zh.srt'),
    ]

    const ranked = rankSubtitlesByRelevance(
      subtitles,
      'JAC-089.restored.mp4',
      'JAC-089',
    )

    expect(ranked.map(subtitle => subtitle.id)).toEqual(['exact', 'unknown'])
  })

  it('115 当前视频绑定字幕不会因标题含其他番号被丢弃', () => {
    const subtitles = [
      createSubtitle('built-in', '历史上传 JAC-090', undefined, {
        source: 'Built-in',
        trustedForVideo: true,
      }),
      createSubtitle('exact', 'JAC-089.zh.srt'),
    ]

    const ranked = rankSubtitlesByRelevance(
      subtitles,
      'JAC-089.restored.mp4',
      'JAC-089',
    )

    expect(ranked.map(subtitle => subtitle.id)).toContain('built-in')
  })
})
