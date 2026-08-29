import { unsafeWindow } from '$'
import { appLogger } from '@/utils/logger'

/** 新版 115 文件接口中，文件项会同时出现新旧两组兼容字段。 */
export interface OfficialFileItem {
  n: string
  cid?: string | number
  fc?: 0 | 1 | string | number
  fid?: string | number
  ico?: string
  iv?: string | number
  modified_time?: string | number
  original_name?: string
  pc?: string
  pick_code?: string
  pid?: string | number
  play_long?: string | number
  s?: string | number
  sc?: string
  sha?: string
  sha1?: string
  type?: string
  vdi?: string | number
  video_duration?: string | number
}

type FileDataListener = () => void

const logger = appLogger.sub('OfficialFileData')
const FETCH_CAPTURE_MARKER = '__115masterOfficialFileCapture__'
const DEFAULT_MAX_ITEMS = 2048

/** 判断未知值是否是新版文件列表项。 */
export function isOfficialFileItem(value: unknown): value is OfficialFileItem {
  if (!value || typeof value !== 'object')
    return false

  const item = value as Partial<OfficialFileItem>
  return typeof item.n === 'string'
    && Boolean(item.fid ?? item.cid ?? item.pc ?? item.pick_code)
}

/** 获取文件项稳定标识；接口缺少 ID 时才退回目录和文件名组合。 */
export function getOfficialFileKey(item: OfficialFileItem): string {
  const id = item.fid ?? item.cid ?? item.pc ?? item.pick_code
  return id === undefined
    ? `${String(item.pid ?? '')}:${item.n}`
    : String(id)
}

/**
 * 新版文件接口数据仓库。
 *
 * 页面接口和适配器共用这一个实例，避免为每一行重复请求文件元数据。
 */
export class OfficialFileDataStore {
  private readonly items = new Map<string, OfficialFileItem>()
  private readonly itemsByName = new Map<string, OfficialFileItem[]>()
  private readonly listeners = new Set<FileDataListener>()

  constructor(private readonly maxItems = DEFAULT_MAX_ITEMS) {}

  get size(): number {
    return this.items.size
  }

  /** 清空数据，供页面销毁或测试隔离使用。 */
  clear(): void {
    this.items.clear()
    this.itemsByName.clear()
  }

  /** 写入一次文件列表响应。 */
  ingest(payload: unknown, source = 'unknown'): number {
    /*
     * ================================================================================
     * 步骤1：提取并索引新版文件数据
     * ================================================================================
     * 目标：兼容普通文件、标签、家庭共享和 APS 回退接口的响应形状。
     * 数据源：页面原生 fetch 响应或适配器补查响应。
     * 操作：
     * 1) 过滤有效文件项
     * 2) 按稳定 ID 合并，并重建文件名索引
     */
    logger.info('开始索引新版文件数据', source)

    const data = this.extractItems(payload)
    for (const item of data) {
      const key = getOfficialFileKey(item)
      this.items.set(key, {
        ...this.items.get(key),
        ...item,
      })
    }

    const evicted = this.trim()
    this.rebuildNameIndex()
    if (data.length > 0)
      this.listeners.forEach(listener => listener())

    logger.info('新版文件数据索引完成', source, data.length, evicted)
    return data.length
  }

  /** 按新版列表行文件名查找对应接口对象。 */
  findByName(name: string, currentCid: string, occurrence = 0): OfficialFileItem | null {
    const candidates = this.itemsByName.get(name) ?? []
    const currentDirectoryItems = candidates.filter(item =>
      String(item.pid ?? '') === currentCid,
    )
    const scoped = currentDirectoryItems.length > 0
      ? currentDirectoryItems
      : candidates
    return scoped[occurrence] ?? null
  }

  /** 只列出当前目录文件项，并保持接口写入顺序。 */
  list(currentCid: string): OfficialFileItem[] {
    return Array.from(this.items.values()).filter(item =>
      item.pid === undefined || String(item.pid) === currentCid,
    )
  }

  /** 列出跨目录聚合页的全部文件项，并保持接口写入顺序。 */
  listAll(): OfficialFileItem[] {
    return Array.from(this.items.values())
  }

  /** 判断仓库中是否已有指定稳定文件 key。 */
  has(key: string): boolean {
    return this.items.has(key)
  }

  /** 监听数据写入。 */
  subscribe(listener: FileDataListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 从未知响应中提取文件数组。 */
  private extractItems(payload: unknown): OfficialFileItem[] {
    if (!payload || typeof payload !== 'object')
      return []

    const response = payload as { data?: unknown }
    if (!Array.isArray(response.data))
      return []

    return response.data.filter(isOfficialFileItem)
  }

  /** 限制当前页面文件索引的内存占用，优先淘汰最早写入项。 */
  private trim(): number {
    let evicted = 0
    while (this.items.size > this.maxItems) {
      const oldest = this.items.keys().next().value
      if (oldest === undefined)
        break
      this.items.delete(oldest)
      evicted += 1
    }
    return evicted
  }

  /** 重建文件名索引，确保重命名后不会保留旧文件名。 */
  private rebuildNameIndex(): void {
    this.itemsByName.clear()
    for (const item of this.items.values()) {
      const names = new Set([
        item.n,
        item.original_name,
      ].filter((name): name is string => Boolean(name)))
      for (const name of names) {
        const items = this.itemsByName.get(name) ?? []
        items.push(item)
        this.itemsByName.set(name, items)
      }
    }
  }
}

export const officialFileData = new OfficialFileDataStore()

/** 新版页面中可安全当作真实文件对象处理的接口。 */
const FILE_LIST_PATHS = new Set([
  '/files',
  '/files/search',
  '/natsort/files.php',
  '/usershare/filelist',
])

/** 判断请求是否为新版文件列表接口。 */
export function isOfficialFileListRequest(url: string): boolean {
  try {
    const baseUrl = globalThis.location?.href ?? 'https://115.com/'
    const parsed = new URL(url, baseUrl)
    return FILE_LIST_PATHS.has(parsed.pathname)
  }
  catch {
    return false
  }
}

/** 获取 fetch 入参中的请求地址。 */
function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string')
    return input
  if (input instanceof URL)
    return input.href
  return input.url
}

/** 异步读取响应副本，不阻塞 115 页面消费原始响应。 */
function captureResponse(response: Response, requestUrl: string): void {
  const responseUrl = response.url || requestUrl
  if (!isOfficialFileListRequest(responseUrl))
    return

  void response.clone().json().then(
    payload => officialFileData.ingest(payload, responseUrl),
  ).catch(error => logger.warn('读取新版文件接口响应失败', responseUrl, error))
}

/**
 * 在 document-start 阶段监听新版页面原生 fetch。
 *
 * 只克隆文件列表响应，返回给官方页面的 Promise 和 Response 均保持不变。
 */
export function installOfficialFileCapture(): void {
  /*
   * ================================================================================
   * 步骤1：安装新版文件接口捕获器
   * ================================================================================
   * 目标：在 Next.js 首次请求发生时取得 fid、pc、sha 等 DOM 中缺失的数据。
   * 数据源：unsafeWindow.fetch。
   * 操作：
   * 1) 跳过已安装或不支持 fetch 的页面
   * 2) 包装原生 fetch，并异步解析文件列表响应副本
   */
  logger.info('开始安装新版文件接口捕获器')

  const pageWindow = unsafeWindow as unknown as Window & typeof globalThis
  const currentFetch = pageWindow.fetch as typeof fetch & {
    [FETCH_CAPTURE_MARKER]?: boolean
  }

  if (typeof currentFetch !== 'function' || currentFetch[FETCH_CAPTURE_MARKER]) {
    logger.info('新版文件接口捕获器无需重复安装')
    return
  }

  const capturedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = getRequestUrl(input)
    const responsePromise = currentFetch.call(pageWindow, input, init)
    void responsePromise
      .then(response => captureResponse(response, requestUrl))
      .catch(() => {})
    return responsePromise
  }) as typeof fetch & { [FETCH_CAPTURE_MARKER]?: boolean }

  Object.defineProperty(capturedFetch, FETCH_CAPTURE_MARKER, {
    configurable: false,
    enumerable: false,
    value: true,
  })

  try {
    pageWindow.fetch = capturedFetch
    logger.info('新版文件接口捕获器安装完成')
  }
  catch (error) {
    logger.warn('新版文件接口捕获器安装失败，将使用目录补查', error)
  }
}
