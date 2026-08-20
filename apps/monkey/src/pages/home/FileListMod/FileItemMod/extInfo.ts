import type { App } from 'vue'
import { defer } from 'lodash'
import { createApp } from 'vue'
import ExtInfo from '@/pages/home/components/ExtInfo/index.vue'
import { FileListType, FileType, IvType } from '@/pages/home/types'
import mainStyles from '@/styles/main.css?inline'
import { adoptShadowStyle } from '@/utils/adoptShadowStyle'
import { normalizeAvNumber } from '@/utils/jav/jav'
import { appLogger } from '@/utils/logger'
import { FileItemModBase } from './base'
import {
  FILE_ITEM_PRELOAD_MARGIN,
  isWithinFileItemPreloadRange,
  watchFileItemPreloadRange,
} from './preloadRange'

/** 番号资料增强共用日志。 */
const logger = appLogger.sub('FileItemModExtInfo')

/**
 * FileItemMod 扩展信息
 */
export class FileItemModExtInfo extends FileItemModBase {
  readonly SETTING_KEYS = ['enableAvInfo'] as const

  private container: HTMLDivElement | null = null
  private vueApp: App | null = null
  private visibilityObserver: IntersectionObserver | null = null
  private stopPreloadWatch: (() => void) | null = null

  onLoad() {
    const avNumber = this.itemInfo.avNumber

    // 如果文件列表类型为网格，则不加载扩展信息
    if (this.itemInfo.fileListType === FileListType.grid) {
      return
    }

    /*
     * ================================================================================
     * 步骤1：核对番号详情文件类型
     * ================================================================================
     * 目标：视频文件保持原有规则，ISO 只在文件名主体就是番号时加载详情。
     * 数据源：115 文件类型、文件名和已提取番号。
     * 操作：
     * 1) 识别常见视频扩展名
     * 2) 规范化 ISO 文件名主体并与番号比较
     */
    logger.info('开始核对番号详情文件类型', avNumber ?? '', this.itemInfo.attributes.title)

    /** 1.1 视频扩展名继续配合 115 iv 标记判定 */
    const title = this.itemInfo.attributes.title
    const video = /\.(?:3gp|avi|flv|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|rm|rmvb|ts|vob|webm|wmv)$/i.test(title)

    /** 1.2 ISO 只允许规范化后与已提取番号完全一致的文件名主体 */
    const iso = /\.iso$/i.test(title)
      && normalizeAvNumber(title.replace(/\.iso$/i, '')) === normalizeAvNumber(avNumber)
    if (
      this.itemInfo.attributes.iv !== IvType.Yes
      || this.itemInfo.attributes.file_type !== FileType.file
      || (!video && !iso)
    ) {
      logger.info('番号详情文件类型核对完成，跳过', avNumber ?? '', title)
      return
    }
    logger.info('番号详情文件类型核对完成，允许加载', avNumber ?? '', iso ? 'iso' : 'video')

    // 如果视频没有番号，则不加载扩展信息
    if (!avNumber) {
      return
    }

    this.itemNode.classList.add('with-ext-info')

    /** 创建容器元素 */
    const extInfoContainer = document.createElement('div')
    extInfoContainer.style.width = '100%'
    extInfoContainer.style.minHeight = this.itemInfo.surface === 'official'
      && this.itemInfo.presentation !== 'panel'
      ? '1px'
      : '96px'
    extInfoContainer.setAttribute('data-115master-detail', '')
    extInfoContainer.setAttribute('data-115master-av-number', avNumber)
    this.itemNode.append(extInfoContainer)
    this.container = extInfoContainer

    /*
     * ================================================================================
     * 步骤2：延迟挂载视口外详情组件
     * ================================================================================
     * 目标：大目录只创建视口附近的 Vue 与 Shadow DOM，减少首屏阻塞。
     * 数据源：文件列表滚动容器和详情占位节点。
     * 操作：
     * 1) 提前 600px 观察即将进入视口的详情
     * 2) 命中后只挂载一次
     */
    logger.info('开始监听番号详情可见区域', avNumber)
    const ownerWindow = extInfoContainer.ownerDocument.defaultView
    const Observer = ownerWindow?.IntersectionObserver
    if (!Observer) {
      this.mountApp(avNumber)
      logger.info('番号详情可见区域监听完成，使用即时挂载', avNumber)
      return
    }

    const scrollBox = this.itemInfo.listScrollBoxNode
    if (isWithinFileItemPreloadRange(extInfoContainer, scrollBox)) {
      this.mountApp(avNumber)
      logger.info('番号详情可见区域监听完成，使用坐标即时挂载', avNumber)
      return
    }

    const root = scrollBox instanceof Element && scrollBox.contains(extInfoContainer)
      ? scrollBox
      : null
    this.visibilityObserver = new Observer((entries) => {
      if (!entries.some(entry => entry.isIntersecting))
        return
      this.visibilityObserver?.disconnect()
      this.visibilityObserver = null
      this.stopPreloadWatch?.()
      this.stopPreloadWatch = null
      this.mountApp(avNumber)
    }, {
      root,
      rootMargin: `${FILE_ITEM_PRELOAD_MARGIN}px 0px`,
    })
    this.visibilityObserver.observe(extInfoContainer)
    this.stopPreloadWatch = watchFileItemPreloadRange(
      extInfoContainer,
      scrollBox,
      () => {
        this.visibilityObserver?.disconnect()
        this.visibilityObserver = null
        this.stopPreloadWatch?.()
        this.stopPreloadWatch = null
        this.mountApp(avNumber)
      },
    )
    logger.info('番号详情可见区域监听完成', avNumber)
  }

  onDestroy() {
    logger.info('开始卸载旧版页面番号资料')
    this.visibilityObserver?.disconnect()
    this.visibilityObserver = null
    this.stopPreloadWatch?.()
    this.stopPreloadWatch = null
    const app = this.vueApp
    this.vueApp = null

    /** 延迟卸载 Vue，避免阻塞新的文件列表加载 */
    defer(() => {
      app?.unmount()
    })
    this.container?.remove()
    this.container = null
    this.itemNode.classList.remove('with-ext-info')
    logger.info('旧版页面番号资料卸载完成')
  }

  private mountApp(avNumber: string) {
    if (this.vueApp || !this.container?.isConnected)
      return

    /*
     * ================================================================================
     * 步骤3：挂载可见番号详情
     * ================================================================================
     * 目标：复用共享样式表，并在进入预加载范围后启动资料请求。
     * 数据源：当前详情容器和番号。
     * 操作：
     * 1) 创建 Shadow DOM 并采用共享样式
     * 2) 挂载 Vue 详情组件
     */
    logger.info('开始挂载可见番号详情', avNumber)

    /** 创建 shadow DOM */
    const shadowRoot = this.container.attachShadow({ mode: 'open' })

    /** 在 shadow DOM 中采用文档级共享样式 */
    adoptShadowStyle(shadowRoot, mainStyles)

    /** 在 shadow DOM 中创建挂载点，data-theme 跟随应用当前主题 */
    const extInfoDom = this.container.ownerDocument.createElement('div')
    extInfoDom.className = 'ext-info-root'
    const appRoot = this.container.ownerDocument.getElementById('my-app')
    const theme = this.itemInfo.surface === 'official'
      ? 'light'
      : appRoot?.getAttribute('data-theme') || 'dark'
    extInfoDom.setAttribute('data-theme', theme)
    shadowRoot.appendChild(extInfoDom)

    /** 创建并挂载 Vue 应用 */
    const app = createApp(ExtInfo, {
      avNumber,
      variant: this.itemInfo.surface === 'official'
        ? this.itemInfo.presentation === 'panel'
          ? 'official-panel'
          : 'official'
        : 'legacy',
    })
    app.mount(extInfoDom)
    this.vueApp = app
    logger.info('可见番号详情挂载完成', avNumber)
  }
}
