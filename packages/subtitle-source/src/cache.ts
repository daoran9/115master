/**
 * 处理后的 subtitlecat 字幕
 */
export interface ProcessedSubtitle {
  id: string
  raw: Blob
  format: string
  title: string
  downloads: number
  /** 1=赞, -1=踩, 0=无 */
  comment: 1 | -1 | 0
  originLanguage: string
  targetLanguage: string
  /** 字幕来源。 */
  source?: string
  /** 已核对的标准番号。 */
  avNumber?: string
}
