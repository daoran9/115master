import type { IRequest } from '@115master/shared'

/**
 * 字幕客户端依赖配置
 */
export interface SubtitleDeps {
  request: IRequest
  /** 从任意标题或文件名提取标准番号。 */
  extractAvNumber?: (value: string) => null | string
}

/** JAV 专用字幕源必须使用调用方的标准番号提取器。 */
export interface AvSubtitleDeps extends SubtitleDeps {
  extractAvNumber: (value: string) => null | string
}
