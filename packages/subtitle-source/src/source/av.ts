const logger = {
  info: (...args: unknown[]) => console.info('[115Master:AvSubtitle]', ...args),
}

/* eslint-disable jsdoc/convert-to-jsdoc-comments */

/** 去掉分隔符后比较两个标准番号。 */
export function normalizeAvNumber(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** 使用统一提取器核对候选文本是否属于目标番号。 */
export function matchesAvNumber(
  value: string,
  avNumber: string,
  extract: (value: string) => null | string,
): boolean {
  /*
   * ================================================================================
   * 步骤1：核对字幕番号身份
   * ================================================================================
   * 目标：候选标题必须能提取出与当前视频完全相同的番号。
   * 数据源：候选文本、目标番号和 Fusion 番号提取器。
   * 操作：
   * 1) 提取候选番号
   * 2) 去掉分隔符后做完整相等比较
   */
  logger.info('开始核对字幕番号身份', avNumber)

  // 1.1 提取候选番号，无法提取时不把包含关系当成命中。
  const candidate = extract(value)
  const matched = Boolean(
    candidate
    && normalizeAvNumber(candidate) === normalizeAvNumber(avNumber),
  )

  logger.info('字幕番号身份核对完成', candidate ?? '', matched)
  return matched
}

/** 生成各字幕站常见的番号检索写法。 */
export function buildAvSearchTerms(avNumber: string): string[] {
  /*
   * ================================================================================
   * 步骤2：生成番号检索词
   * ================================================================================
   * 目标：兼容横线、空格和无分隔符三种站内索引。
   * 数据源：Fusion 已标准化的番号。
   * 操作：
   * 1) 统一兼容字符
   * 2) 生成三种写法并去重
   */
  logger.info('开始生成番号检索词', avNumber)

  // 2.1 保留标准写法，同时生成空格和紧凑写法。
  const canonical = avNumber.normalize('NFKC').trim().toUpperCase()
  const terms = [
    canonical,
    canonical.replace(/[-_.\s]+/g, ' '),
    normalizeAvNumber(canonical),
  ].filter((value, index, values) => value && values.indexOf(value) === index)

  logger.info('番号检索词生成完成', terms)
  return terms
}
