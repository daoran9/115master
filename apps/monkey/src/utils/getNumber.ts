import { appLogger } from '@/utils/logger'

const logger = appLogger.sub('GetNumber')

interface AvNumberPattern {
  pattern: RegExp
  format: (match: RegExpMatchArray) => string
}

interface AvNumberMatch {
  index: number
  match: RegExpMatchArray
  format: AvNumberPattern['format']
}

const STANDARD_SEPARATOR = String.raw`[-_.\s]+`
const STANDARD_SUFFIX = String.raw`(?:[-_\s]?(?:uncensored|mp4|hhb|uc|ch|ver|[a-z]))?`

/** 去掉恢复工具插入到粘连番号中的多余前导零，同时保留三位正式编号。 */
function normalizeCompactDigits(digits: string): string {
  let normalized = digits
  while (normalized.length > 3 && normalized.startsWith('0'))
    normalized = normalized.slice(1)
  return normalized
}

/** 只从恢复文件剥离工具附加的三位顺序号，合法数字开头系列保持不变。 */
function stripRecoverySequencePrefix(cleanName: string, normalizedName: string): string {
  /*
   * ================================================================================
   * 步骤1：识别恢复工具顺序号
   * ================================================================================
   * 目标：把 390JAC-089、483SGK-079 还原为真实番号，同时保留 140CM-18。
   * 数据源：清洗后的文件名和原始恢复标记。
   * 操作：
   * 1) 只接受 restored/stored 文件标记
   * 2) 只剥离紧贴三到六位字母前缀的三位顺序号
   */
  logger.info('开始检查恢复文件顺序号', cleanName)

  /** 1.1 恢复文件标记和无码整理标签都说明三位数字可能是抓取顺序号。 */
  const hasRecoveryMarker
    = /(?:^|[._\s-])(?:re)?stored(?:[._\s-]|$)/i.test(normalizedName)
      || /^\s*[【[]\s*(?:无码破解|无码流出)\s*[】\]]/.test(normalizedName)
  if (!hasRecoveryMarker) {
    logger.info('恢复文件顺序号检查完成，无恢复标记')
    return cleanName
  }

  /** 1.2 清洗中文后保留的括号属于标签边界，跳过它再剥离三位顺序号。 */
  const result = cleanName.replace(
    /^([^a-z0-9]*)\d{3}(?=[a-z]{3,6}[-_.\s]+\d{2,5}(?:[-_\s]?(?:uncensored|mp4|hhb|uc|ch|ver|[a-z]))?(?:[^a-z0-9]|$))/i,
    '$1',
  )
  logger.info('恢复文件顺序号检查完成', result)
  return result
}

/** 常见番号格式；特殊系列必须排在通用规则前面。 */
const AV_NUMBER_PATTERNS: AvNumberPattern[] = [
  {
    pattern: /(?<![a-z0-9])fc2(?:[\s._-]*ppv)?[\s._-]*(\d{5,8})(?!\d)/i,
    format: match => `FC2-PPV-${match[1]}`,
  },
  {
    pattern: /(?<![a-z0-9])heyzo[\s._-]*(\d{4})(?!\d)/i,
    format: match => `HEYZO-${match[1]}`,
  },
  {
    pattern: /(?<![a-z0-9])(mdx|mky|md)(?:[\s_-]*(ns))?[\s_-]*(\d{3,4})(?![a-z0-9])/i,
    format: (match) => {
      const prefix = match[1]!.toUpperCase()
      return `${prefix}${match[2] ? '-NS' : ''}-${match[3]}`
    },
  },
  {
    pattern: /(?<!\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(\d{2})[\s_-]+(\d{2,3})(?!\d)/,
    format: match => `${match[1]}${match[2]}${match[3]}_${match[4]}`,
  },
  {
    pattern: /(?<![a-z0-9])heydouga[\s_-]+(\d{4})[\s_-]+(\d{3,4})(?!\d)/i,
    format: match => `${match[1]}-${match[2]}`,
  },
  {
    pattern: /(?<![a-z0-9])(?:carib|caribbean)[a-z]*[\s_-]*(\d{3,6})[\s_-]+(\d{3})(?!\d)/i,
    format: match => `CARIB-${match[1]}-${match[2]}`,
  },
  {
    pattern: /(?<![a-z0-9])tokyo[\s_-]*hot[\s_-]*([a-z])(\d{4})(?![a-z0-9])/i,
    format: match => `TOKYO-HOT-${match[1]!.toUpperCase()}${match[2]}`,
  },
  {
    pattern: /(?<![a-z0-9])([a-z]{1,6}\d{1,2})-(\d{3})(?![a-z0-9])/i,
    format: match => `${match[1]!.toUpperCase()}-${match[2]}`,
  },
  {
    pattern: new RegExp(
      String.raw`(?<![a-z0-9])(\d{3}[a-z]{2,6})${STANDARD_SEPARATOR}(\d{2,5})${STANDARD_SUFFIX}(?![a-z0-9])`,
      'i',
    ),
    format: match => `${match[1]!.toUpperCase()}-${match[2]}`,
  },
  {
    pattern: new RegExp(
      String.raw`(?<![a-z0-9])1([a-z]{2,5})${STANDARD_SEPARATOR}(\d{2,5})${STANDARD_SUFFIX}(?![a-z0-9])`,
      'i',
    ),
    format: match => `${match[1]!.toUpperCase()}-${match[2]}`,
  },
  {
    pattern: /(?<![A-Za-z0-9])([A-Za-z]{2,5})[-_.\s]+(\d{2,5})(?=[A-Z]{2,5}[~～])/,
    format: match => `${match[1]!.toUpperCase()}-${match[2]}`,
  },
  {
    pattern: new RegExp(
      String.raw`(?<![a-z0-9])([a-z]{6,12})${STANDARD_SEPARATOR}(\d{2,5})${STANDARD_SUFFIX}(?![a-z0-9])`,
      'i',
    ),
    format: match => `${match[1]!.toUpperCase()}-${match[2]}`,
  },
  {
    pattern: new RegExp(
      String.raw`(?<![a-z0-9])([a-z]{2,5})${STANDARD_SEPARATOR}(\d{2,5})${STANDARD_SUFFIX}(?![a-z0-9])`,
      'i',
    ),
    format: match => `${match[1]!.toUpperCase()}-${match[2]}`,
  },
  {
    pattern: new RegExp(
      String.raw`(?<![a-z0-9])([a-z]{2,5})(\d{2,5})${STANDARD_SUFFIX}(?![a-z0-9])`,
      'i',
    ),
    format: match => `${match[1]!.toUpperCase()}-${normalizeCompactDigits(match[2]!)}`,
  },
]

/** 在所有格式中选择文件名位置最靠前的候选，同位置仍保留特殊格式优先级。 */
function findAvNumberMatch(cleanName: string): AvNumberMatch | undefined {
  /*
   * ================================================================================
   * 步骤1：收集并排序番号候选
   * ================================================================================
   * 目标：标题后半段的 140CM-18 不能覆盖开头的 NCYF-014。
   * 数据源：全部特殊系列和通用番号规则。
   * 操作：
   * 1) 每条规则各取第一个匹配
   * 2) 选择字符位置最靠前的结果，同位置保持规则优先级
   */
  logger.info('开始定位最靠前番号候选', cleanName)

  let bestMatch: AvNumberMatch | undefined
  AV_NUMBER_PATTERNS.forEach(({ pattern, format }) => {
    /** 1.1 正则均不带 global 标记，每次 exec 都从文件名开头独立查找。 */
    const match = pattern.exec(cleanName)
    if (!match || match.index === undefined)
      return
    if (!bestMatch || match.index < bestMatch.index) {
      bestMatch = { index: match.index, match, format }
    }
  })

  logger.info('最靠前番号候选定位完成', bestMatch?.match[0] ?? '')
  return bestMatch
}

/**
 * 提取番号
 * @param filename 文件名
 * @returns 提取到的番号，如果没有找到则返回null
 */
export function getAvNumber(filename: string): string | null {
  /*
   * ================================================================================
   * 步骤1：规范化文件名
   * ================================================================================
   * 目标：移除域名、扩展名和标题文字，同时保留番号与相邻数字的边界。
   * 数据源：115 文件名。
   * 操作：
   * 1) 把中日文替换为空格，避免删除后把标题数字粘到番号末尾
   * 2) 清除常见站点前缀和恢复文件标记
   */
  logger.info('开始提取番号', filename)

  /** 1.1 统一兼容字符并移除会切断番号的零宽字符。 */
  const normalizedName = filename
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')

  /** 1.2 已停用的 MyFans 来源不再生成详情键，也不能误走普通番号来源。 */
  if (
    /myfans(?:\.jp)?|マイファン[ズス]/i.test(normalizedName)
    || /\(@?[a-z][a-z0-9.]*_[\w.-]+\)/i.test(normalizedName)
    || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^()]{0,32}\([a-z][a-z0-9.]{2,}\)/u.test(normalizedName)
  ) {
    logger.info('番号格式匹配完成，忽略 MyFans 文件')
    return null
  }
  /** 1.3 清理文件名中的干扰字符，并用空格保留文字两侧边界。 */
  const cleanName = normalizedName
  // 清除 BBCode URL 标签，避免标签挡住开头的站点域名清理。
    .replace(/\[\/?url(?:=[^\]]+)?\]/gi, '')
  // 清楚域名(hjd2048.com)
    .replace(/^\[?(\w+\.)+[A-Z]+\]?@?/gi, '')
    // 移除文件扩展名(.mp4)
    .replace(/\.\w+$/, '')
  // 清除恢复工具和转码工具追加的来源尾标，避免 prob43、iris31 被当成番号。
    .replace(/[._-](?:re)?stored\d*(?:[._-].*)?$/i, '')
    .replace(/[\^._-]+wm(?:\d+|[._-].*)?$/i, '')
  // 清除中文
    .replace(/[\u4E00-\u9FA5]/g, ' ')
  // 清除日语
    .replace(/[\u3040-\u309F\u30A0-\u30FF]/g, ' ')
  // 电影常用格式名称
    .replace(/BDRIP|HDR/gi, '')
  // 清除@SIS001@
    .replace(/@\w+@/, '')
  // 清除 share_db86f06fdfbf31573ca6828ac0716d22
    .replace(/share_\w{32}/, '')
  // 清除站点域名后附带的四位发布批次，如 0629mide661
    .replace(/^[-_.]?\d{4}(?=[a-z]{2,5}\d{2,5}(?:[^a-z0-9]|$))/i, '')

  /**
   * ================================================================================
   * 步骤2：按格式优先级匹配番号
   * ================================================================================
   * 目标：优先识别特殊站点格式，再处理通用字母数字番号。
   * 数据源：规范化后的文件名。
   * 操作：
   * 1) 依次尝试格式规则
   * 2) 返回首个结果；全部失败时返回 null
   */
  const candidateName = stripRecoverySequencePrefix(cleanName, normalizedName)
  logger.info('开始匹配番号格式', candidateName)

  /** 2.1 选择最靠前候选，避免标题数字抢走文件名开头的番号。 */
  const candidate = findAvNumberMatch(candidateName)
  if (candidate) {
    const result = candidate.format(candidate.match)
    logger.info('番号格式匹配完成', result)
    return result
  }

  logger.info('番号格式匹配完成，未识别', filename)
  return null
}
