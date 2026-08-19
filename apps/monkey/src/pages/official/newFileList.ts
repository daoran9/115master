import type { OfficialFileItem } from './fileData'
import type { FileItemAttributes, ItemInfo } from '@/pages/home/types'
import { format } from '@115master/utils'
import { FileItemModLoader } from '@/pages/home/FileListMod/FileItemLoader'
import { FileItemModActressInfo } from '@/pages/home/FileListMod/FileItemMod/actressInfo'
import { FileItemModClickPlay } from '@/pages/home/FileListMod/FileItemMod/clickPlay'
import { FileItemModDownload } from '@/pages/home/FileListMod/FileItemMod/download'
import { FileItemModExtInfo } from '@/pages/home/FileListMod/FileItemMod/extInfo'
import { FileItemModExtMenu } from '@/pages/home/FileListMod/FileItemMod/extMenu'
import { FileItemModFolderLink } from '@/pages/home/FileListMod/FileItemMod/folderLink'
import { FileItemModVideoCover } from '@/pages/home/FileListMod/FileItemMod/videoCover'
import { FileListType, FileType, IvType } from '@/pages/home/types'
import { drive115 } from '@/utils/drive115Instance'
import { getAvNumber } from '@/utils/getNumber'
import { appLogger } from '@/utils/logger'
import { userSettings } from '@/utils/userSettings'
import {
  getOfficialFileKey,
  isOfficialFileItem,
  officialFileData,
} from './fileData'
import { officialIcons } from './icons'
import { OfficialScrollHistory } from './scrollHistory'
import './index.css'

const itemMods = [
  FileItemModFolderLink,
  FileItemModExtInfo,
  FileItemModActressInfo,
  FileItemModVideoCover,
  FileItemModExtMenu,
  FileItemModClickPlay,
  FileItemModDownload,
]

/** 网格独立面板打开前只绑定原生文件名和文件夹交互。 */
const detachedInteractionMods = [
  FileItemModFolderLink,
  FileItemModClickPlay,
]

/** 网格独立面板首次打开后再加载资料、预览和面板操作。 */
const detachedPanelMods = [
  FileItemModExtInfo,
  FileItemModActressInfo,
  FileItemModVideoCover,
  FileItemModExtMenu,
  FileItemModDownload,
]

const ADAPTER_MARKER = 'data-115master-official-file-list'
/** 115 每个文件同时包含同名内外两层，只有外层带稳定文件 ID。 */
const ITEM_SELECTOR = [
  '.file-list-item[data-file-id]',
  '.file-grid-item[data-file-id]',
].join(',')
const ADDON_SELECTOR = '[data-115master-row-addon]'
const DETAIL_SELECTOR = '[data-115master-detail]'
const PREVIEW_SELECTOR = '[data-115master-preview]'
const ACTIONS_SELECTOR = '[data-115master-native-actions]'
const ACTRESS_SELECTOR = '[data-115master-actress]'
const ACTRESS_HOST_ATTRIBUTE = 'data-115master-actress-host'
const ACTRESS_INLINE_ATTRIBUTE = 'data-115master-actress-inline'
const ACTRESS_INLINE_SELECTOR = `[${ACTRESS_INLINE_ATTRIBUTE}]`
const GRID_TOGGLE_SELECTOR = '[data-115master-grid-toggle]'
const GRID_PANEL_SELECTOR = '[data-115master-grid-panel]'
const DIAGNOSTIC_ATTRIBUTES = [
  'data-115master-official-fallback-error',
  'data-115master-official-fallback-state',
  'data-115master-official-item-count',
  'data-115master-official-missing-count',
  'data-115master-official-row-count',
  'data-115master-official-scope',
] as const

type OfficialViewType = 'list' | 'virtual-list' | 'grid'

interface OfficialDataScope {
  cid: string
  crossDirectory: boolean
  key: string
  fileLabel?: string
  nativeRequestUrl?: string
  searchValue?: string
  shareId?: string
  star?: number
}

const UNSUPPORTED_FILE_SURFACES = [
  '/storage/clouddownload',
  '/storage/linkshare',
  '/storage/localdownload',
  '/storage/mylisten',
  '/storage/mywatch',
  '/storage/recentoperations',
  '/storage/recentreceive',
  '/storage/recyclebin',
]

interface EnhancedRow {
  addon: HTMLElement
  loaders: FileItemModLoader[]
  measurementInterval?: number
  resizeObserver?: ResizeObserver
  signature: string
  virtualIndex?: number
  virtualOriginalSize?: number
  virtualizer?: OfficialVirtualizer
  viewType: OfficialViewType
}

interface OfficialVirtualItem {
  index: number
  size: number
}

interface OfficialVirtualizer {
  getVirtualItems: () => OfficialVirtualItem[]
  resizeItem: (index: number, size: number) => void
}

/** 把新版接口文件项转换成旧版 FileItemMod 使用的属性。 */
export function toLegacyFileAttributes(item: OfficialFileItem): FileItemAttributes {
  const isFolder = Number(item.fc) === 0
    || item.type === 'folder'
    || (!item.fid && Boolean(item.cid))
  const parentCid = String(item.pid ?? '')
  const itemCid = String(item.cid ?? parentCid)

  return {
    c: '',
    cid: parentCid,
    iv: Number(item.iv) === 1 ? IvType.Yes : IvType.No,
    vdi: String(item.vdi ?? ''),
    title: item.n,
    hdf: '',
    file_type: isFolder ? FileType.folder : FileType.file,
    file_mode: '',
    pick_code: item.pc || item.pick_code || '',
    is_share: '',
    is_top: '',
    area_id: '',
    p_id: parentCid,
    cate_id: isFolder ? itemCid : parentCid,
    cate_name: '',
    score: '',
    has_desc: '',
    fl_encode: '',
    fuuid: String(item.fid ?? item.cid ?? ''),
    shared: '',
    has_pass: '',
    issct: '',
    sha1: item.sha1 || item.sha || '',
    file_size: String(item.s ?? ''),
    download_sc: item.sc,
    play_button: '',
  }
}

/** 新版 115 原生文件列表行增强。 */
export class NewOfficialFileListMod {
  private readonly enhancedRows = new Map<HTMLElement, EnhancedRow>()
  private readonly failedFallbackSignatures = new Map<string, string>()
  private readonly fallbackLoads = new Map<string, Promise<void>>()
  private readonly loadedFallbackSignatures = new Set<string>()
  private readonly logger = appLogger.sub('NewOfficialFileListMod')
  private readonly scrollHistory = new OfficialScrollHistory()
  private readonly virtualizers = new WeakMap<HTMLElement, OfficialVirtualizer>()
  private active = false
  private fallbackError = ''
  private fallbackState: 'complete' | 'error' | 'idle' | 'loading' = 'idle'
  private observer: MutationObserver | null = null
  private scheduledUpdate: number | null = null
  private unsubscribeData: (() => void) | null = null

  constructor() {
    this.init()
  }

  /** 销毁新版列表适配器。 */
  destroy(): void {
    if (!this.active)
      return

    /*
     * ================================================================================
     * 步骤1：销毁新版列表适配器
     * ================================================================================
     * 目标：移除观察器、数据订阅和所有行增强。
     * 操作：
     * 1) 停止监听 DOM 与接口数据
     * 2) 逐行卸载旧版 FileItemMod
     */
    this.logger.info('开始销毁新版文件列表适配器')

    this.observer?.disconnect()
    this.observer = null
    if (this.scheduledUpdate !== null)
      window.clearTimeout(this.scheduledUpdate)
    this.scheduledUpdate = null
    this.unsubscribeData?.()
    this.unsubscribeData = null
    this.scrollHistory.destroy()
    this.enhancedRows.forEach((_, row) => this.destroyRow(row))
    this.enhancedRows.clear()
    document.documentElement.removeAttribute(ADAPTER_MARKER)
    DIAGNOSTIC_ATTRIBUTES.forEach(attribute =>
      document.documentElement.removeAttribute(attribute),
    )
    this.active = false

    this.logger.info('新版文件列表适配器销毁完成')
  }

  /** 初始化 DOM 和数据监听。 */
  private init(): void {
    /*
     * ================================================================================
     * 步骤1：启动新版原生列表监听
     * ================================================================================
     * 目标：在 Next.js 路由切换和列表重绘后持续挂载旧版增强。
     * 数据源：.file-list-item、.file-grid-item DOM 与 OfficialFileDataStore。
     * 操作：
     * 1) 用文档标记阻止重复适配
     * 2) 监听文件接口数据和列表 DOM 变化
     */
    this.logger.info('开始启动新版文件列表适配器')

    if (document.documentElement.hasAttribute(ADAPTER_MARKER)) {
      this.logger.info('新版文件列表适配器无需重复启动')
      return
    }

    document.documentElement.setAttribute(ADAPTER_MARKER, __115MASTER_VERSION__)
    this.active = true
    this.syncBootstrapDiagnostics()
    this.unsubscribeData = officialFileData.subscribe(() => this.scheduleUpdate())
    this.observer = new MutationObserver((mutations) => {
      /** 1.1 忽略 Fusion 附加区内部的异步内容变化，避免自身重建。 */
      if (mutations.some(({ target }) => {
        const element = target instanceof Element ? target : target.parentElement
        return !element?.closest(`${ADDON_SELECTOR}, ${GRID_PANEL_SELECTOR}`)
      })) {
        this.scheduleUpdate()
      }
    })
    this.observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'aria-hidden',
        'class',
        'data-file-id',
        'hidden',
        'style',
      ],
    })
    this.scheduleUpdate()

    this.logger.info('新版文件列表适配器启动完成')
  }

  /** 把大量 React DOM 变化合并为一次短延迟列表扫描。 */
  private scheduleUpdate(): void {
    if (!this.active || this.scheduledUpdate !== null)
      return

    /*
     * ================================================================================
     * 步骤2：调度新版文件列表扫描
     * ================================================================================
     * 目标：前台合并密集 DOM 变化，后台标签也能完成首屏和切页扫描。
     * 数据源：文件接口订阅与 115 React 列表 MutationObserver。
     * 操作：
     * 1) 用短定时器合并同一轮变化
     * 2) 不依赖后台标签会暂停的 requestAnimationFrame
     */
    this.logger.info('开始调度新版文件列表扫描')

    this.scheduledUpdate = window.setTimeout(() => {
      this.scheduledUpdate = null
      try {
        this.updateRows()
      }
      catch (error) {
        /*
         * ================================================================================
         * 步骤2.3：记录新版列表扫描异常
         * ================================================================================
         * 目标：扫描异常不能静默中断新版页面，也不能阻断 115 原生列表。
         * 数据源：当前帧的列表扫描异常。
         * 操作：
         * 1) 保留原生 DOM，不再继续挂载本轮增强
         * 2) 写入只读错误摘要，供现场桥和用户 Console 核对
         */
        this.logger.warn('新版文件列表行同步异常', error)
        this.fallbackState = 'error'
        this.fallbackError = error instanceof Error ? error.message : String(error)
        this.syncDiagnostics(
          null,
          document.querySelectorAll<HTMLElement>(ITEM_SELECTOR).length,
          officialFileData.listAll().length,
          0,
        )
      }
      this.logger.info('新版文件列表扫描调度完成')
    }, 16)
  }

  /** 写入适配器已启动但尚未完成首轮扫描的只读状态。 */
  private syncBootstrapDiagnostics(): void {
    /*
     * ================================================================================
     * 步骤1.1：写入新版列表启动诊断
     * ================================================================================
     * 目标：区分适配器未启动、正在扫描和扫描异常。
     * 数据源：适配器初始化状态。
     * 操作：
     * 1) 写入版本、等待状态和当前范围占位值
     * 2) 清理上一轮页面残留的错误摘要
     */
    this.logger.info('开始写入新版列表启动诊断')

    const root = document.documentElement
    root.setAttribute('data-115master-official-fallback-state', 'init')
    root.setAttribute('data-115master-official-row-count', '0')
    root.setAttribute('data-115master-official-item-count', '0')
    root.setAttribute('data-115master-official-missing-count', '0')
    root.setAttribute('data-115master-official-scope', 'pending')
    root.removeAttribute('data-115master-official-fallback-error')

    this.logger.info('新版列表启动诊断写入完成')
  }

  /** 扫描并增强当前可见的新版文件行。 */
  private updateRows(): void {
    /*
     * ================================================================================
     * 步骤2：同步新版原生文件行
     * ================================================================================
     * 目标：让每个可见文件行使用旧版番号、预览、头像、播放和下载增强。
     * 数据源：当前 DOM 文件名与接口数据仓库。
     * 操作：
     * 1) 按当前名称、原始名称、大小和接口顺序匹配接口对象
     * 2) 新建、替换或销毁对应 FileItemModLoader
     */
    this.logger.info('开始同步新版文件列表行')

    const rows = Array.from(document.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
      .filter(row => this.isVisibleFileRow(row))
    const currentRows = new Set(rows)
    const scope = this.getCurrentDataScope()
    if (!scope) {
      /*
       * ================================================================================
       * 步骤2.1：清理不支持的特殊页面
       * ================================================================================
       * 目标：分享记录、接收记录、操作记录和回收站不误用旧目录数据。
       * 数据源：当前新版路由和已有 Fusion 附加区。
       * 操作：
       * 1) 卸载当前可见行增强
       * 2) 保留 115 原生列表和交互
       */
      this.logger.info('开始清理不支持的新版特殊页面')
      rows.forEach(row => this.destroyRow(row))
      this.syncDiagnostics(null, rows.length, 0, rows.length)
      this.logger.info('不支持的新版特殊页面清理完成')
      this.logger.info('新版文件列表行同步完成', 0)
      return
    }

    /** 2.1 先读取 React 当前行已经持有的真实文件对象，覆盖跨目录类型筛选。 */
    this.ingestEmbeddedRowData(rows)
    const items = scope.crossDirectory
      ? officialFileData.listAll()
      : officialFileData.list(scope.cid)
    const used = new Set<string>()
    let hasMissingData = false
    let missingCount = 0

    for (const row of rows) {
      /** 2.1 每个稳定文件 key 在本轮扫描中只允许分配一次。 */
      const item = this.matchRow(row, items, used)
      if (!item) {
        hasMissingData = true
        missingCount += 1
        if (this.enhancedRows.has(row))
          this.destroyRow(row)
        else
          this.cleanupRow(row)
        continue
      }
      used.add(getOfficialFileKey(item))

      const viewType = this.getViewType(row)
      const signature = this.getSignature(item, viewType)
      const enhanced = this.enhancedRows.get(row)
      if (
        enhanced?.signature === signature
        && this.isRowEnhancementCurrent(row, item, enhanced)
      ) {
        continue
      }

      if (enhanced)
        this.destroyRow(row)
      else
        this.cleanupRow(row)
      this.enhanceRow(row, item, signature, viewType)
    }

    for (const row of this.enhancedRows.keys()) {
      if (!currentRows.has(row) || !row.isConnected)
        this.destroyRow(row)
    }

    /** 2.2 清除 React 重绘后遗留、且已不属于当前文件行的插件附加区。 */
    const activeRows = new Set(this.enhancedRows.keys())
    document.querySelectorAll<HTMLElement>(ADDON_SELECTOR).forEach((addon) => {
      const owner = addon.parentElement
      if (
        !owner
        || !currentRows.has(owner)
        || !activeRows.has(owner)
        || this.enhancedRows.get(owner)?.addon !== addon
      ) {
        addon.remove()
      }
    })

    const firstRow = rows[0]
    if (firstRow) {
      const scrollBox = this.findScrollBox(firstRow)
      this.scrollHistory.sync(
        scrollBox,
        `${window.location.pathname}${window.location.search}:${this.getViewType(firstRow)}`,
      )
    }

    if (hasMissingData)
      void this.loadCurrentScope(scope, rows)

    this.syncDiagnostics(scope, rows.length, items.length, missingCount)

    this.logger.info('新版文件列表行同步完成', rows.length)
  }

  /** 把现场匹配与补查状态写到适配器标记，不输出文件名或文件 ID。 */
  private syncDiagnostics(
    scope: OfficialDataScope | null,
    rowCount: number,
    itemCount: number,
    missingCount: number,
  ): void {
    /*
     * ================================================================================
     * 步骤2.2：同步新版只读诊断
     * ================================================================================
     * 目标：普通浏览器测试桥无需控制台权限也能定位首屏零增强原因。
     * 数据源：当前范围、可见行、已索引文件和补查状态。
     * 操作：
     * 1) 只写计数、范围和错误摘要
     * 2) 不暴露文件名、文件 ID、Cookie 或接口正文
     */
    this.logger.info('开始同步新版文件适配诊断')

    const root = document.documentElement
    root.setAttribute('data-115master-official-row-count', String(rowCount))
    root.setAttribute('data-115master-official-item-count', String(itemCount))
    root.setAttribute('data-115master-official-missing-count', String(missingCount))
    root.setAttribute('data-115master-official-scope', scope?.key ?? 'unsupported')
    root.setAttribute('data-115master-official-fallback-state', this.fallbackState)
    if (this.fallbackError) {
      root.setAttribute(
        'data-115master-official-fallback-error',
        this.fallbackError.slice(0, 300),
      )
    }
    else {
      root.removeAttribute('data-115master-official-fallback-error')
    }

    this.logger.info('新版文件适配诊断同步完成')
  }

  /** 判断原生文件行是否仍在新版列表中可见。 */
  private isVisibleFileRow(row: HTMLElement): boolean {
    /*
     * ================================================================================
     * 步骤2.1：过滤不可见原生文件行
     * ================================================================================
     * 目标：虚拟列表隐藏或复用行时同步卸载对应 Fusion 面板。
     * 数据源：原生行属性、计算样式和布局盒。
     * 操作：
     * 1) 排除 hidden、aria-hidden、display 和 visibility 隐藏状态
     * 2) 排除已经没有布局尺寸的行
     */
    this.logger.info('开始判断新版文件行可见性')

    // 2.1 检查原生隐藏标记和计算样式。
    if (
      row.hidden
      || row.getAttribute('aria-hidden') === 'true'
      || window.getComputedStyle(row).display === 'none'
      || window.getComputedStyle(row).visibility === 'hidden'
    ) {
      this.logger.info('新版文件行不可见')
      return false
    }

    /** 2.2 没有布局盒时，115 已将该行移出当前渲染窗口。 */
    const box = row.getBoundingClientRect()
    const visible = box.width > 0 && box.height > 0
    this.logger.info('新版文件行可见性判断完成', visible)
    return visible
  }

  /** 从 React 文件行属性批量补齐跨目录筛选结果。 */
  private ingestEmbeddedRowData(rows: HTMLElement[]): void {
    /*
     * ================================================================================
     * 步骤3：读取新版虚拟行文件数据
     * ================================================================================
     * 目标：视频等跨目录筛选不依赖普通目录接口，仍取得 fid、pc、sha 和父目录。
     * 数据源：115 React 写在当前文件行上的 __reactProps / __reactFiber 属性。
     * 操作：
     * 1) 只检查数据仓库尚未覆盖的稳定文件 ID
     * 2) 同时核对文件 ID 与完整名称后批量写入数据仓库
     */
    this.logger.info('开始读取新版虚拟行文件数据')

    const embeddedItems: OfficialFileItem[] = []
    for (const row of rows) {
      const fileId = row.getAttribute('data-file-id')?.trim()
      if (!fileId || officialFileData.has(fileId))
        continue

      const item = this.findEmbeddedRowFileItem(row, fileId)
      if (item)
        embeddedItems.push(item)
    }

    if (embeddedItems.length > 0)
      officialFileData.ingest({ data: embeddedItems }, 'react-row')

    this.logger.info('新版虚拟行文件数据读取完成', embeddedItems.length)
  }

  /** 在单行 React 属性树中查找与当前 DOM 身份一致的文件对象。 */
  private findEmbeddedRowFileItem(
    row: HTMLElement,
    fileId: string,
  ): OfficialFileItem | null {
    const propertySource = row as unknown as Record<string, unknown>
    const reactProperties = Object.getOwnPropertyNames(row)
      .filter(key => key.startsWith('__reactProps$') || key.startsWith('__reactFiber$'))
      .sort((left, right) => Number(right.startsWith('__reactProps$')) - Number(left.startsWith('__reactProps$')))
    const queue = reactProperties.map(key => ({
      depth: 0,
      value: propertySource[key],
    }))
    const rowNames = this.getRowNames(row).map(name => name.trim().toLocaleLowerCase())
    const seen = new WeakSet<object>()
    let inspected = 0

    while (queue.length > 0 && inspected < 200) {
      const current = queue.shift()
      const value = current?.value
      if (
        !current
        || !value
        || (typeof value !== 'object' && typeof value !== 'function')
      ) {
        continue
      }

      const object = value as object
      if (seen.has(object))
        continue
      seen.add(object)
      inspected += 1

      if (isOfficialFileItem(value) && getOfficialFileKey(value) === fileId) {
        const itemNames = [value.n, value.original_name]
          .filter((name): name is string => Boolean(name))
          .map(name => name.trim().toLocaleLowerCase())
        if (rowNames.length === 0 || rowNames.every(name => itemNames.includes(name)))
          return value
      }

      if (current.depth >= 6 || value instanceof Element)
        continue

      const record = value as Record<string, unknown>
      const keys = Array.isArray(value)
        ? Object.keys(value).slice(0, 80)
        : Object.keys(record)
            .filter(key => !['alternate', 'child', 'return', 'sibling'].includes(key))
            .slice(0, 80)
      for (const key of keys) {
        try {
          queue.push({ depth: current.depth + 1, value: record[key] })
        }
        catch {
          // React may expose guarded development getters; they are not file data.
        }
      }
    }

    return null
  }

  /** 为单个新版文件行装配旧版增强。 */
  private enhanceRow(
    row: HTMLElement,
    item: OfficialFileItem,
    signature: string,
    viewType: OfficialViewType,
  ): void {
    /*
     * ================================================================================
     * 步骤3：装配单个新版文件行
     * ================================================================================
     * 目标：复用旧版 FileItemModLoader，同时保持 115 原生文件行不变。
     * 数据源：新版接口文件项和当前行 DOM。
     * 操作：
     * 1) 在原生行末尾创建完全由插件管理的独立附加区
     * 2) 转换 ItemInfo 并只向附加区加载旧版增强
     */
    this.logger.info('开始装配新版文件行', item.n)

    // 3.1 清除 React 复用行或旧适配器遗留的孤立增强容器。
    this.cleanupRow(row)
    const addon = document.createElement('section')
    addon.setAttribute('data-115master-row-addon', '')
    addon.setAttribute('data-115master-view', viewType)
    addon.setAttribute('data-115master-file-key', getOfficialFileKey(item))
    addon.setAttribute('data-115master-name', item.n)
    addon.setAttribute('aria-label', `${item.n} 的 115Master 增强信息`)
    row.append(addon)

    /** 3.2 只有网格保留可选独立层；普通列表和虚拟列表都走旧版行内增强。 */
    if (viewType === 'grid') {
      this.enhanceDetachedItem(row, addon, item, viewType)
      this.logger.info('新版网格独立详情文件项装配完成', item.n)
      return
    }

    const attributes = toLegacyFileAttributes(item)
    this.createActions(addon, attributes.file_type)

    const scrollBox = this.findScrollBox(row)
    const itemInfo: ItemInfo = {
      avNumber: this.getFileAvNumber(attributes.title),
      attributes,
      duration: Number(item.play_long ?? item.video_duration ?? 0) || 0,
      fileListType: FileListType.list,
      listScrollBoxNode: scrollBox,
      surface: 'official',
      interactionNode: row,
    }
    const loader = new FileItemModLoader(
      addon,
      FileListType.list,
      scrollBox,
      itemMods,
      itemInfo,
    )

    loader.load()
    const measurement = viewType === 'virtual-list'
      ? this.attachVirtualRowMeasurement(row, scrollBox)
      : {}
    this.enhancedRows.set(row, {
      addon,
      loaders: [loader],
      ...measurement,
      signature,
      viewType,
    })

    this.logger.info('新版文件行装配完成', item.n)
  }

  /** 为新版网格创建不挤压原生卡片的可选独立增强层。 */
  private enhanceDetachedItem(
    row: HTMLElement,
    addon: HTMLElement,
    item: OfficialFileItem,
    viewType: Extract<OfficialViewType, 'grid'>,
  ): void {
    /*
     * ================================================================================
     * 步骤4：装配新版独立详情层
     * ================================================================================
     * 目标：网格卡片只放小型入口，详情和预览在插件弹层中共存。
     * 数据源：当前文件项、视图类型和已转换的旧版文件属性。
     * 操作：
     * 1) 创建不改变原生尺寸的 Fusion 图标按钮
     * 2) 创建挂在 body 的独立面板并复用列表增强模块
     */
    this.logger.info('开始装配新版独立详情层', viewType, item.n)

    // 4.1 为真实 115 网格文件项建立定位上下文，避免按钮叠到列表右上角。
    row.setAttribute('data-115master-panel-anchor', viewType)
    row.setAttribute('data-115master-grid-anchor', '')

    /** 4.2 创建小型按钮，不改变原生卡片或虚拟行尺寸。 */
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.setAttribute('data-115master-grid-toggle', '')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-label', `查看 ${item.n} 的 Fusion 详情`)
    toggle.title = 'Fusion 详情与预览'
    const toggleIcon = document.createElement('iconify-icon')
    toggleIcon.noobserver = true
    toggleIcon.inline = true
    toggleIcon.icon = officialIcons.rocket
    toggleIcon.setAttribute('aria-hidden', 'true')
    toggle.append(toggleIcon)
    addon.append(toggle)

    /** 4.3 独立面板挂到 body，避免 React 虚拟容器 overflow 裁剪。 */
    const panel = document.createElement('section')
    panel.setAttribute('data-115master-grid-panel', '')
    panel.setAttribute('data-115master-panel-view', viewType)
    panel.setAttribute('data-115master-file-key', getOfficialFileKey(item))
    panel.setAttribute('data-115master-name', item.n)
    panel.setAttribute('aria-label', `${item.n} 的 Fusion 详情与预览`)
    panel.hidden = true
    document.body.append(panel)

    const header = document.createElement('header')
    header.setAttribute('data-115master-grid-panel-header', '')
    const title = document.createElement('strong')
    title.textContent = item.n
    const close = document.createElement('button')
    close.type = 'button'
    close.setAttribute('data-115master-grid-close', '')
    close.setAttribute('aria-label', '关闭 Fusion 详情与预览')
    close.title = '关闭'
    const closeIcon = document.createElement('iconify-icon')
    closeIcon.noobserver = true
    closeIcon.inline = true
    closeIcon.icon = officialIcons.close
    closeIcon.setAttribute('aria-hidden', 'true')
    close.append(closeIcon)
    header.append(title, close)

    const content = document.createElement('div')
    content.setAttribute('data-115master-grid-panel-content', '')
    panel.append(header, content)

    const attributes = toLegacyFileAttributes(item)
    this.createActions(content, attributes.file_type)
    const scrollBox = this.findScrollBox(row)
    const itemInfo: ItemInfo = {
      avNumber: this.getFileAvNumber(attributes.title),
      attributes,
      duration: Number(item.play_long ?? item.video_duration ?? 0) || 0,
      fileListType: FileListType.list,
      listScrollBoxNode: scrollBox,
      surface: 'official',
      presentation: 'panel',
      interactionNode: row,
    }

    /*
     * ================================================================================
     * 步骤5：拆分原生交互与面板内容生命周期
     * ================================================================================
     * 目标：文件名播放立即可用，详情和预览只在用户展开面板后加载。
     * 数据源：当前原生文件行、独立面板内容和用户功能设置。
     * 操作：
     * 1) 立即绑定文件名与文件夹交互
     * 2) 首次打开面板后挂载资料、预览和下载操作
     */
    this.logger.info('开始拆分新版独立面板加载生命周期', item.n)

    /** 5.1 原生文件名交互不能依赖面板是否打开。 */
    const interactionLoader = new FileItemModLoader(
      addon,
      FileListType.list,
      scrollBox,
      detachedInteractionMods,
      itemInfo,
    )
    interactionLoader.load()

    /** 5.2 面板模块只构造不加载，避免隐藏面板阻止可见性回调。 */
    const panelLoader = new FileItemModLoader(
      content,
      FileListType.list,
      scrollBox,
      detachedPanelMods,
      itemInfo,
    )
    let panelLoaded = false

    toggle.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const opening = panel.hidden
      document.querySelectorAll<HTMLElement>(GRID_PANEL_SELECTOR).forEach((candidate) => {
        candidate.hidden = candidate !== panel || !opening
      })
      document.querySelectorAll<HTMLButtonElement>(GRID_TOGGLE_SELECTOR).forEach((candidate) => {
        candidate.setAttribute('aria-expanded', String(candidate === toggle && opening))
      })
      panel.hidden = !opening
      if (opening && !panelLoaded) {
        this.logger.info('开始加载已展开的新版独立面板', item.n)
        panelLoaded = true
        panelLoader.load()
        this.logger.info('已展开的新版独立面板加载完成', item.n)
      }
    })
    close.addEventListener('click', () => {
      panel.hidden = true
      toggle.setAttribute('aria-expanded', 'false')
      toggle.focus()
    })

    this.enhancedRows.set(row, {
      addon,
      loaders: [interactionLoader, panelLoader],
      signature: this.getSignature(item, viewType),
      viewType,
    })
    addon.setAttribute('data-115master-panel-key', getOfficialFileKey(item))
    panel.setAttribute('data-115master-owner-id', getOfficialFileKey(item))

    this.logger.info('新版独立面板加载生命周期拆分完成', item.n)
    this.logger.info('新版独立详情层装配完成', viewType, item.n)
  }

  /** 让 115 自己按行内增强后的真实高度重排虚拟列表。 */
  private attachVirtualRowMeasurement(
    row: HTMLElement,
    scrollBox: HTMLElement,
  ): Pick<
    EnhancedRow,
    | 'measurementInterval'
    | 'resizeObserver'
    | 'virtualIndex'
    | 'virtualOriginalSize'
    | 'virtualizer'
  > {
    /*
     * ================================================================================
     * 步骤6：接入新版虚拟列表行高测量
     * ================================================================================
     * 目标：详情或预览改变当前行高度后，由 115 的虚拟列表重排后续文件。
     * 数据源：原生 data-index、React Fiber 内的 TanStack Virtual 实例和当前行布局盒。
     * 操作：
     * 1) 找到当前文件行所属的虚拟列表实例
     * 2) 用 ResizeObserver 持续回报行内增强后的真实高度
     */
    this.logger.info('开始接入新版虚拟列表行高测量')

    /** 6.1 只有带稳定虚拟索引的绝对定位文件行参与动态测量。 */
    const virtualIndex = Number(row.getAttribute('data-index'))
    const virtualizer = Number.isInteger(virtualIndex)
      ? this.findOfficialVirtualizer(row, scrollBox)
      : null
    if (!virtualizer) {
      this.logger.warn('新版虚拟列表行高测量不可用', virtualIndex)
      return {}
    }

    /** 6.2 保存 115 原始行高，卸载插件附加区时恢复虚拟列表缓存。 */
    const currentVirtualItems = virtualizer.getVirtualItems()
    const virtualOriginalSize = currentVirtualItems
      .find(item => item.index === virtualIndex)
      ?.size
      ?? row.getBoundingClientRect().height
    let measuredSize = 0
    const measure = () => {
      if (!row.isConnected)
        return

      const nextSize = row.getBoundingClientRect().height
      const cachedSize = virtualizer.getVirtualItems()
        .find(item => item.index === virtualIndex)
        ?.size
      row.setAttribute(
        'data-115master-virtual-measure',
        `${nextSize}:${cachedSize ?? 'missing'}`,
      )
      const rowSizeUnchanged = Math.abs(nextSize - measuredSize) < 0.5
      const virtualSizeCurrent = cachedSize !== undefined
        && Math.abs(nextSize - cachedSize) < 0.5
      if (nextSize <= 0 || (rowSizeUnchanged && virtualSizeCurrent))
        return

      measuredSize = nextSize
      virtualizer.resizeItem(virtualIndex, nextSize)
      this.logger.info('新版虚拟列表行高已更新', virtualIndex, nextSize)
    }

    /** 6.3 详情、封面和演员信息异步挂载时自动重新测量当前文件行。 */
    const ResizeObserverClass = row.ownerDocument.defaultView?.ResizeObserver
    const resizeObserver = ResizeObserverClass
      ? new ResizeObserverClass(() => measure())
      : undefined
    resizeObserver?.observe(row)
    measure()
    const measurementInterval = window.setInterval(measure, 500)

    this.logger.info('新版虚拟列表行高测量接入完成', virtualIndex)
    return {
      measurementInterval,
      resizeObserver,
      virtualIndex,
      virtualOriginalSize,
      virtualizer,
    }
  }

  /** 从原生 React Fiber 中读取当前文件列表使用的 TanStack Virtual 实例。 */
  private findOfficialVirtualizer(
    row: HTMLElement,
    scrollBox: HTMLElement,
  ): OfficialVirtualizer | null {
    /*
     * ================================================================================
     * 步骤6.1：定位 115 虚拟列表实例
     * ================================================================================
     * 目标：复用 115 已有的动态行高和总滚动高度计算，不自行改写原生 transform。
     * 数据源：当前文件行的 __reactFiber 属性及祖先组件 Hook。
     * 操作：
     * 1) 优先复用同一滚动容器已识别的实例
     * 2) 沿 Fiber 祖先和 Hook 链查找 resizeItem/getVirtualItems 合约
     */
    this.logger.info('开始定位新版虚拟列表实例')

    /** 6.1.1 同一滚动容器内的所有可见文件行共用一个虚拟列表实例。 */
    const cached = this.virtualizers.get(scrollBox)
    if (cached) {
      this.logger.info('新版虚拟列表实例定位完成，使用缓存')
      return cached
    }

    /** 6.1.2 从当前 DOM 节点取得 React Fiber，并限制遍历深度避免扫描整棵应用树。 */
    const rowSource = row as unknown as Record<string, unknown>
    const fiberKey = Object.getOwnPropertyNames(row)
      .find(key => key.startsWith('__reactFiber$'))
    let fiber = fiberKey
      ? rowSource[fiberKey] as Record<string, unknown> | null
      : null

    for (let level = 0; fiber && level < 24; level += 1) {
      let hook = fiber.memoizedState as Record<string, unknown> | null
      for (let hookIndex = 0; hook && hookIndex < 40; hookIndex += 1) {
        const state = hook.memoizedState
        const stateRecord = state && typeof state === 'object'
          ? state as Record<string, unknown>
          : null
        const candidates = [state, stateRecord?.current]
        const virtualizer = candidates.find(candidate =>
          this.isOfficialVirtualizer(candidate),
        ) as OfficialVirtualizer | undefined
        if (virtualizer) {
          this.virtualizers.set(scrollBox, virtualizer)
          this.logger.info('新版虚拟列表实例定位完成', level, hookIndex)
          return virtualizer
        }
        hook = hook.next as Record<string, unknown> | null
      }
      fiber = fiber.return as Record<string, unknown> | null
    }

    this.logger.warn('新版虚拟列表实例定位失败')
    return null
  }

  /** 判断未知 React Hook 值是否满足虚拟列表最小合约。 */
  private isOfficialVirtualizer(value: unknown): value is OfficialVirtualizer {
    if (!value || typeof value !== 'object')
      return false

    const candidate = value as Partial<OfficialVirtualizer>
    return typeof candidate.getVirtualItems === 'function'
      && typeof candidate.resizeItem === 'function'
  }

  /** 创建旧版菜单和下载增强依赖的兼容操作栏。 */
  private createActions(addon: HTMLElement, fileType: FileType): void {
    /*
     * ================================================================================
     * 步骤3.2：创建插件独立下载入口
     * ================================================================================
     * 目标：文件和文件夹都在 Fusion 附加区拥有对应下载命令。
     * 数据源：接口文件类型。
     * 操作：
     * 1) 文件使用 download_one
     * 2) 文件夹使用 download_dir_one
     */
    this.logger.info('开始创建新版文件下载入口', fileType)

    const actions = document.createElement('div')
    actions.className = 'file-opr'
    actions.setAttribute('data-115master-native-actions', '')

    const download = document.createElement('a')
    download.href = 'javascript:void(0)'
    download.setAttribute(
      'menu',
      fileType === FileType.folder ? 'download_dir_one' : 'download_one',
    )
    download.textContent = '下载'
    actions.append(download)
    addon.append(actions)
    this.logger.info('新版文件下载入口创建完成', fileType)
  }

  /** 卸载一行增强，并清理适配标记。 */
  private destroyRow(row: HTMLElement): void {
    const enhanced = this.enhancedRows.get(row)
    if (!enhanced) {
      this.cleanupRow(row)
      return
    }

    enhanced.resizeObserver?.disconnect()
    if (enhanced.measurementInterval !== undefined)
      window.clearInterval(enhanced.measurementInterval)
    enhanced.loaders.forEach(loader => loader.destroy())
    if (enhanced.viewType === 'grid') {
      const key = enhanced.addon.getAttribute('data-115master-panel-key')
      if (key) {
        document.querySelectorAll<HTMLElement>(GRID_PANEL_SELECTOR).forEach((panel) => {
          if (panel.getAttribute('data-115master-owner-id') === key)
            panel.remove()
        })
      }
    }
    enhanced.addon.remove()
    if (
      enhanced.virtualizer
      && enhanced.virtualIndex !== undefined
      && enhanced.virtualOriginalSize !== undefined
    ) {
      enhanced.virtualizer.resizeItem(
        enhanced.virtualIndex,
        enhanced.virtualOriginalSize,
      )
    }
    this.cleanupRow(row)
    this.enhancedRows.delete(row)
  }

  /** 清除 beta.5 曾写入原生行的插件节点和样式标记。 */
  private cleanupRow(row: HTMLElement): void {
    row.querySelectorAll([
      DETAIL_SELECTOR,
      PREVIEW_SELECTOR,
      ACTIONS_SELECTOR,
      ACTRESS_SELECTOR,
      GRID_TOGGLE_SELECTOR,
    ].join(',')).forEach(node => node.remove())
    row.querySelectorAll<HTMLElement>(`[${ACTRESS_HOST_ATTRIBUTE}]`).forEach((host) => {
      host.classList.remove('with-actress-info')
      host.removeAttribute(ACTRESS_HOST_ATTRIBUTE)
    })
    row.querySelectorAll<HTMLElement>(ACTRESS_INLINE_SELECTOR)
      .forEach(node => node.removeAttribute(ACTRESS_INLINE_ATTRIBUTE))
    row.classList.remove(
      'with-ext-info',
      'with-ext-video-cover',
      'with-actress-info',
    )
    row.removeAttribute('data-115master-enhanced')
    row.removeAttribute('data-115master-file-key')
    row.removeAttribute('data-115master-name')
    row.removeAttribute('data-115master-grid-anchor')
    row.removeAttribute('data-115master-panel-anchor')
  }

  /** 核对当前行只保留与本文件对应的一份详情、预览和操作栏。 */
  private isRowEnhancementCurrent(
    row: HTMLElement,
    item: OfficialFileItem,
    enhanced: EnhancedRow,
  ): boolean {
    const viewType = this.getViewType(row)
    if (enhanced.viewType !== viewType)
      return false

    if (viewType === 'grid') {
      const key = getOfficialFileKey(item)
      const panel = Array.from(
        document.querySelectorAll<HTMLElement>(GRID_PANEL_SELECTOR),
      ).find(candidate => candidate.getAttribute('data-115master-owner-id') === key)
      return enhanced.addon.isConnected
        && enhanced.addon.parentElement === row
        && enhanced.addon.getAttribute('data-115master-file-key') === key
        && row.getAttribute('data-115master-panel-anchor') === viewType
        && enhanced.addon.querySelectorAll(GRID_TOGGLE_SELECTOR).length === 1
        && Boolean(panel?.isConnected)
    }

    const attributes = toLegacyFileAttributes(item)
    const avNumber = this.getFileAvNumber(attributes.title)
    const details = Array.from(
      enhanced.addon.querySelectorAll<HTMLElement>(DETAIL_SELECTOR),
    )
    const previews = Array.from(
      enhanced.addon.querySelectorAll<HTMLElement>(PREVIEW_SELECTOR),
    )
    const actions = enhanced.addon.querySelectorAll(ACTIONS_SELECTOR)
    const addonActresses = enhanced.addon.querySelectorAll(ACTRESS_SELECTOR)
    const inlineActresses = Array.from(
      row.querySelectorAll<HTMLElement>(ACTRESS_SELECTOR),
    ).filter(node => !enhanced.addon.contains(node))
    const name = row.querySelector<HTMLElement>('.file-name-responsive')
    const hasInlineActress = enhanced.addon.hasAttribute(ACTRESS_INLINE_ATTRIBUTE)
    const inlineActressMatches = inlineActresses.length === 1
      && inlineActresses[0]?.nextElementSibling === name
    const inlineActressCurrent = hasInlineActress
      ? inlineActressMatches
      : inlineActresses.length === 0
    const legacy = Array.from(row.querySelectorAll<HTMLElement>([
      DETAIL_SELECTOR,
      PREVIEW_SELECTOR,
      ACTIONS_SELECTOR,
    ].join(','))).filter(node => !enhanced.addon.contains(node))
    const expectsDetail = Boolean(
      userSettings.value.enableAvInfo
      && avNumber
      && (
        attributes.iv === IvType.Yes
        || attributes.file_type === FileType.folder
      ),
    )
    const expectsPreview = userSettings.value.enableFilelistPreview
      && attributes.iv === IvType.Yes
    const expectsActions = true

    return enhanced.addon.isConnected
      && enhanced.addon.parentElement === row
      && enhanced.addon.getAttribute('data-115master-file-key')
      === getOfficialFileKey(item)
      && legacy.length === 0
      && addonActresses.length === 0
      && inlineActressCurrent
      && details.length === Number(expectsDetail)
      && previews.length === Number(expectsPreview)
      && actions.length === Number(expectsActions)
      && (!expectsDetail
        || details[0]?.getAttribute('data-115master-av-number') === avNumber)
      && (!expectsPreview
        || previews[0]?.getAttribute('data-115master-pick-code')
        === attributes.pick_code)
  }

  /** 初次注入或特殊列表切换时，补查当前可见文件数据。 */
  private async loadCurrentScope(
    scope: OfficialDataScope,
    rows: HTMLElement[],
  ): Promise<void> {
    const rowTokens = rows.map(row => [
      row.getAttribute('data-file-id')?.trim() ?? '',
      ...this.getRowNames(row),
    ].join(':'))
    const missingIds = rows
      .map(row => row.getAttribute('data-file-id')?.trim() ?? '')
      .filter(id => id.length > 0 && !officialFileData.has(id))
    const signature = `${scope.key}:${scope.nativeRequestUrl ?? ''}:${rowTokens.join(',')}`
    const previousFailure = this.failedFallbackSignatures.get(signature)
    if (previousFailure) {
      this.fallbackState = 'error'
      this.fallbackError = previousFailure
      return
    }

    if (this.loadedFallbackSignatures.has(signature)) {
      this.fallbackState = 'complete'
      this.fallbackError = ''
      return
    }

    const pending = this.fallbackLoads.get(signature)
    if (pending) {
      this.fallbackState = 'loading'
      return pending
    }

    /*
     * ================================================================================
     * 步骤4：补查当前页面文件数据
     * ================================================================================
     * 目标：处理脚本注入较晚、星标页或搜索页没有目录缓存的情况。
     * 数据源：页面最近一次原生文件请求，或普通 /files 回退接口。
     * 操作：
     * 1) 按路由构造只读请求，并为同一缺失集合去重
     * 2) 分页写入共用仓库，直到覆盖当前 DOM 文件 ID
     */
    this.logger.info('开始补查新版页面文件数据', signature)
    this.fallbackState = 'loading'
    this.fallbackError = ''

    const load = this.fetchScopePages(scope, missingIds).then(() => {
      this.failedFallbackSignatures.delete(signature)
      this.loadedFallbackSignatures.add(signature)
      this.fallbackState = 'complete'
      this.fallbackError = ''
      this.logger.info('新版页面文件数据补查完成', signature)
    }).catch((error) => {
      this.fallbackState = 'error'
      this.fallbackError = error instanceof Error ? error.message : String(error)
      this.failedFallbackSignatures.set(signature, this.fallbackError)
      this.logger.warn('新版页面文件数据补查失败', signature, error)
    }).finally(() => {
      this.fallbackLoads.delete(signature)
      this.scheduleUpdate()
    })

    this.fallbackLoads.set(signature, load)
    return load
  }

  /** 分页补查当前页面，直到覆盖可见 ID 或接口没有更多数据。 */
  private async fetchScopePages(
    scope: OfficialDataScope,
    missingIds: string[],
  ): Promise<void> {
    const pageSize = 1150
    let offset = 0
    let total = Number.POSITIVE_INFINITY

    while (offset < total) {
      /** 4.1 优先重放当前页面原生只读请求，保留标签和共享参数。 */
      const response = scope.nativeRequestUrl
        ? await this.fetchNativeScopePage(scope.nativeRequestUrl, offset, pageSize)
        : scope.fileLabel
          ? await drive115.tag.getFilesByLabel({
              file_label: scope.fileLabel,
              limit: pageSize,
              offset,
            })
          : scope.searchValue
            ? await drive115.file.searchFiles({
                aid: 1,
                cid: scope.cid,
                count_folders: 1,
                limit: pageSize,
                offset,
                search_value: scope.searchValue,
                show_dir: 1,
              })
            : await drive115.file.getFilesWithFallback({
                aid: 1,
                cid: scope.cid,
                format: 'json',
                limit: pageSize,
                natsort: 1,
                offset,
                show_dir: 1,
                ...(scope.star !== undefined && { star: scope.star }),
              })

      /** 4.2 失败响应不能当作空目录缓存，否则当前签名将永久停止补查。 */
      const responseStatus = response as unknown as {
        error?: unknown
        message?: unknown
        state?: boolean
      }
      if (responseStatus.state === false) {
        throw new Error(
          String(
            responseStatus.message
            || responseStatus.error
            || '新版文件接口返回失败状态',
          ),
        )
      }

      officialFileData.ingest(response, `fallback:${scope.key}:${offset}`)
      const data = Array.isArray(response.data) ? response.data : []
      total = Number(response.count ?? data.length)
      offset += data.length

      // 4.3 当前可见文件都已覆盖，或接口没有继续分页时立即停止。
      if (
        missingIds.every(id => officialFileData.has(id))
        || data.length === 0
      ) {
        break
      }
    }
  }

  /** 重放新版页面最近一次原生文件请求，并只改分页参数。 */
  private async fetchNativeScopePage(
    requestUrl: string,
    offset: number,
    limit: number,
  ): Promise<Record<string, unknown>> {
    /*
     * ================================================================================
     * 步骤4.2：重放特殊文件列表请求
     * ================================================================================
     * 目标：保留 file_label、share_id、source 等页面原生筛选条件。
     * 数据源：Performance Resource Timing 中最近一次匹配请求。
     * 操作：
     * 1) 仅更新 offset 和 limit
     * 2) 带登录凭据读取 JSON，不写任何文件状态
     */
    this.logger.info('开始重放新版特殊文件列表请求', requestUrl, offset)

    const url = new URL(requestUrl)
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('limit', String(limit))
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok)
      throw new Error(`特殊文件列表请求失败: HTTP ${response.status}`)
    const payload = await response.json() as Record<string, unknown>

    this.logger.info('新版特殊文件列表请求完成', url.href)
    return payload
  }

  /** 从新版 URL 识别目录、星标和搜索的数据范围。 */
  private getCurrentDataScope(): OfficialDataScope | null {
    const url = new URL(window.location.href)
    const latestNativeRequest = this.getLatestNativeFileRequest()
    const pathname = url.pathname

    /*
     * ================================================================================
     * 步骤5：识别新版特殊文件页
     * ================================================================================
     * 目标：只增强真实文件对象，不把分享记录、聊天记录或回收站记录当文件。
     * 数据源：当前路由和最近一次原生文件接口。
     * 操作：
     * 1) 排除非文件对象页面
     * 2) 为标签页和家庭共享内部页保留原生请求条件
     */
    this.logger.info('开始识别新版特殊文件页', pathname)

    // 5.1 已确认响应不是普通文件对象的页面保持 115 原生表现。
    if (UNSUPPORTED_FILE_SURFACES.some(prefix => pathname.startsWith(prefix))) {
      this.logger.info('新版特殊文件页识别完成，不挂载文件增强', pathname)
      return null
    }

    if (pathname === '/storage/filetags') {
      this.logger.info('新版标签根页识别完成，不挂载文件增强')
      return null
    }

    const familyMatch = pathname.match(/^\/storage\/familyshare\/([^/]+)/)
    const shareId = familyMatch?.[1]
    if (pathname.startsWith('/storage/familyshare')) {
      const isCurrentFamilyRequest = Boolean(
        shareId
        && latestNativeRequest?.pathname === '/usershare/filelist'
        && latestNativeRequest.searchParams.get('share_id') === shareId,
      )
      if (!shareId || !isCurrentFamilyRequest) {
        this.logger.info('新版家庭共享根页识别完成，不挂载文件增强')
        return null
      }
    }

    const fileLabel = pathname.startsWith('/storage/filetags/')
      ? pathname.split('/').filter(Boolean)[2] || undefined
      : undefined
    const urlCid = url.searchParams.get('cid') || '0'
    const nativeSearchValue = latestNativeRequest?.pathname === '/files/search'
      ? latestNativeRequest.searchParams.get('search_value') || undefined
      : undefined
    const searchValue = url.searchParams.get('search_value')
      || url.searchParams.get('keyword')
      || url.searchParams.get('search')
      || nativeSearchValue
      || undefined
    const isStarred = pathname.startsWith('/storage/starredfiles')

    /** 5.2 只采用与当前路由筛选条件一致的原生请求。 */
    let nativeRequest: URL | null = null
    if (shareId) {
      nativeRequest = latestNativeRequest?.pathname === '/usershare/filelist'
        && latestNativeRequest.searchParams.get('share_id') === shareId
        ? latestNativeRequest
        : null
    }
    else if (fileLabel) {
      nativeRequest = latestNativeRequest?.pathname === '/files/search'
        && latestNativeRequest.searchParams.get('file_label') === fileLabel
        ? latestNativeRequest
        : null
    }
    else if (isStarred) {
      nativeRequest = latestNativeRequest?.searchParams.get('star') === '1'
        ? latestNativeRequest
        : null
    }
    else if (searchValue) {
      nativeRequest = latestNativeRequest?.pathname === '/files/search'
        && latestNativeRequest.searchParams.get('search_value') === searchValue
        ? latestNativeRequest
        : null
    }
    else if (pathname.startsWith('/storage/allfiles')) {
      const nativeCid = latestNativeRequest?.searchParams.get('cid') || '0'
      const isPlainFileRequest = latestNativeRequest?.pathname === '/files'
        || latestNativeRequest?.pathname === '/natsort/files.php'
      nativeRequest = isPlainFileRequest
        && nativeCid === urlCid
        && !latestNativeRequest?.searchParams.has('file_label')
        && latestNativeRequest?.searchParams.get('star') !== '1'
        ? latestNativeRequest
        : null
    }
    else if (latestNativeRequest?.pathname !== '/usershare/filelist') {
      nativeRequest = latestNativeRequest
    }

    const cid = url.searchParams.get('cid')
      || nativeRequest?.searchParams.get('cid')
      || '0'

    /** 5.3 其他特殊页必须已经发出可识别的文件请求，避免重用上一页缓存。 */
    const knownWithoutNativeRequest = pathname.startsWith('/storage/allfiles')
      || pathname.startsWith('/storage/starredfiles')
      || pathname.startsWith('/storage/filetags/')
    if (!nativeRequest && !knownWithoutNativeRequest) {
      this.logger.info('新版特殊文件页识别完成，等待原生文件请求', pathname)
      return null
    }

    const scope: OfficialDataScope = {
      cid,
      crossDirectory: Boolean(isStarred || searchValue || fileLabel || shareId),
      key: `${pathname}:${cid}:${searchValue ?? ''}:${fileLabel ?? ''}:${shareId ?? ''}:${isStarred ? 'star' : ''}`,
      ...(fileLabel && { fileLabel }),
      ...(nativeRequest && { nativeRequestUrl: nativeRequest.href }),
      ...(searchValue && { searchValue }),
      ...(shareId && { shareId }),
      ...(isStarred && { star: 1 }),
    }
    this.logger.info('新版特殊文件页识别完成', scope.key)
    return scope
  }

  /** 读取页面最近一次原生文件请求，不包装或替换原生 fetch。 */
  private getLatestNativeFileRequest(): URL | null {
    const requests = performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter((name) => {
        try {
          const request = new URL(name)
          return request.pathname === '/files'
            || request.pathname === '/files/search'
            || request.pathname === '/natsort/files.php'
            || request.pathname === '/usershare/filelist'
        }
        catch {
          return false
        }
      })

    const latest = requests[requests.length - 1]
    return latest ? new URL(latest) : null
  }

  /** 获取新版文件行的 title 和可见文本，兼容新版字段分离。 */
  private getRowNames(row: HTMLElement): string[] {
    /*
     * ================================================================================
     * 步骤1：读取 React 重绘后的完整文件名
     * ================================================================================
     * 目标：加载更多后即使外层名称节点没有 title，也能继续匹配原文件。
     * 数据源：名称节点自身、内部标题节点和整行其他标题节点。
     * 操作：
     * 1) 按稳定程度依次查找完整 title
     * 2) 仅在可见文本未截断时把文本作为后备名称
     */
    this.logger.info('开始读取新版文件行名称')

    const nameNode = row.querySelector<HTMLElement>('.file-name-responsive')
    const ownTitle = nameNode?.getAttribute('title')?.trim() ?? ''
    const nestedTitle = nameNode
      ?.querySelector<HTMLElement>('[title]')
      ?.getAttribute('title')
      ?.trim() ?? ''
    const rowTitle = row
      .querySelector<HTMLElement>('img[title], span[title], [data-file-name][title]')
      ?.getAttribute('title')
      ?.trim() ?? ''
    const title = ownTitle || nestedTitle || rowTitle
    const text = nameNode?.textContent?.trim() ?? ''
    const names = [
      title,
      /\.\.\.|…/.test(text) ? '' : text,
    ].filter((name, index, names) => name.length > 0 && names.indexOf(name) === index)

    this.logger.info('新版文件行名称读取完成', names[0] ?? '')
    return names
  }

  /** 从当前文件名识别标准番号。 */
  private getFileAvNumber(fileName: string): string | null {
    this.logger.info('开始识别新版文件番号', fileName)
    const result = getAvNumber(fileName)
    this.logger.info('新版文件番号识别完成', result ?? '')
    return result
  }

  /** 用新版行可见信息匹配尚未分配的接口文件项。 */
  private matchRow(
    row: HTMLElement,
    items: OfficialFileItem[],
    used: ReadonlySet<string>,
  ): OfficialFileItem | null {
    /*
     * ================================================================================
     * 步骤5：唯一匹配新版文件行
     * ================================================================================
     * 目标：处理 original_name 相同、可见文本截断和接口分批到达的列表。
     * 数据源：单行 DOM 与当前目录接口文件顺序。
     * 操作：
     * 1) 排除本轮已经绑定的稳定文件 key
     * 2) 有稳定 ID 时同时核对 ID 与完整名称，无 ID 时才使用名称、大小和番号兜底
     */
    this.logger.info('开始匹配新版文件行')

    /** 5.1 过滤已经分配给其他行的接口文件。 */
    const available = items.filter(item => !used.has(getOfficialFileKey(item)))
    if (available.length === 0) {
      this.logger.info('新版文件行匹配完成，无可用接口文件')
      return null
    }

    /** 5.2 稳定 ID 存在时，必须同时确认接口 key 与所有完整名称。 */
    const rowNames = this.getRowNames(row)
    const normalizedRowNames = rowNames.map(name => name.toLocaleLowerCase())
    const hasFileId = row.hasAttribute('data-file-id')
    const fileId = row.getAttribute('data-file-id')?.trim()
    if (hasFileId) {
      const identified = fileId
        ? available.find(item => getOfficialFileKey(item) === fileId)
        : undefined
      if (!identified) {
        this.logger.info('新版文件行稳定 ID 尚未同步，暂不回退匹配', fileId)
        return null
      }

      const identifiedNames = [identified.n, identified.original_name]
        .filter((name): name is string => Boolean(name))
        .map(name => name.trim().toLocaleLowerCase())
      const hasConfirmedNames = normalizedRowNames.length > 0
        && normalizedRowNames.every(name => identifiedNames.includes(name))
      if (!hasConfirmedNames) {
        this.logger.info('新版文件行完整名称尚未同步，暂不回退匹配', fileId)
        return null
      }

      this.logger.info('新版文件行按文件 ID 和完整名称匹配完成', identified.n)
      return identified
    }

    /** 5.3 缺少稳定 ID 时按完整名称匹配，兼容 title 与可见文本分离。 */
    const named = normalizedRowNames.length > 0
      ? available.filter(item => [item.n, item.original_name].some(value =>
          Boolean(value && normalizedRowNames.includes(value.trim().toLocaleLowerCase())),
        ))
      : []

    if (named.length === 1) {
      this.logger.info('新版文件行按完整名称匹配完成', named[0].n)
      return named[0]
    }

    /** 5.4 多个同名候选只允许用文件大小唯一消歧。 */
    const size = this.getRowSize(row)
    const sized = size && named.length > 1
      ? named.filter(item => this.formatSize(item.s) === size)
      : []
    if (sized.length === 1) {
      this.logger.info('新版文件行按名称和大小匹配完成', sized[0].n)
      return sized[0]
    }

    /** 5.5 缺少稳定 ID 且完整名称无结果时，才允许按可见番号唯一匹配。 */
    const rowNumbers = new Set(
      rowNames
        .map(name => this.getFileAvNumber(name)?.toLocaleUpperCase())
        .filter((number): number is string => Boolean(number)),
    )
    const numbered = available.filter(item => [item.n, item.original_name]
      .some((name) => {
        const number = name
          ? this.getFileAvNumber(name)?.toLocaleUpperCase()
          : undefined
        return Boolean(number && rowNumbers.has(number))
      }))
    if (numbered.length === 1) {
      this.logger.info('新版文件行按可见番号匹配完成', numbered[0].n)
      return numbered[0]
    }

    /** 5.6 SPA 切目录期间不按接口顺序猜测，等待文件身份同步后再挂增强。 */
    this.logger.info('新版文件行匹配完成，身份尚未同步')
    return null
  }

  /** 获取新版列表行显示的文件大小。 */
  private getRowSize(row: HTMLElement): string {
    return this.normalizeSize(
      row.querySelector<HTMLElement>('.file-info-responsive')?.textContent ?? '',
    )
  }

  /** 把接口字节数转换成新版页面可比较的大小文本。 */
  private formatSize(size: OfficialFileItem['s']): string {
    const bytes = Number(size)
    return Number.isFinite(bytes) && bytes > 0
      ? this.normalizeSize(format.fileSize(bytes))
      : ''
  }

  /** 统一大小文本中的空格和大小写。 */
  private normalizeSize(size: string): string {
    return size.replace(/\s+/g, '').toLocaleUpperCase()
  }

  /** 文件关键字段变化时重建对应增强。 */
  private getSignature(item: OfficialFileItem, viewType: OfficialViewType): string {
    return [
      viewType,
      getOfficialFileKey(item),
      item.n,
      item.pc ?? item.pick_code ?? '',
      item.sha1 ?? item.sha ?? '',
      item.iv ?? '',
      item.play_long ?? item.video_duration ?? '',
    ].join(':')
  }

  /** 判断新版文件项当前使用列表还是网格视图。 */
  private getViewType(row: HTMLElement): OfficialViewType {
    if (row.matches('.file-grid-item[data-file-id]'))
      return 'grid'

    const style = window.getComputedStyle(row)
    return style.position === 'absolute'
      && (row.hasAttribute('data-index') || style.transform !== 'none')
      ? 'virtual-list'
      : 'list'
  }

  /** 查找最接近列表行的滚动容器。 */
  private findScrollBox(row: HTMLElement): HTMLElement {
    let current = row.parentElement
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current)
      if (/auto|scroll/.test(style.overflowY))
        return current
      current = current.parentElement
    }
    return document.scrollingElement instanceof HTMLElement
      ? document.scrollingElement
      : document.documentElement
  }
}
