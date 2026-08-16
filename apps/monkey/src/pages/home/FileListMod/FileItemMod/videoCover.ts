import type { App } from 'vue'
import { createApp } from 'vue'
import ExtVideoCover from '@/pages/home/components/ExtVideoCover/index.vue'
import { FileListType, IvType } from '@/pages/home/types'
import mainStyles from '@/styles/main.css?inline'
import { appLogger } from '@/utils/logger'
import { FileItemModBase } from './base'
import {
  FILE_ITEM_PRELOAD_MARGIN,
  isWithinFileItemPreloadRange,
  watchFileItemPreloadRange,
} from './preloadRange'

/** 视频封面增强共用日志。 */
const logger = appLogger.sub('FileItemModVideoCover')

/**
 * FileItemMod 视频封面
 */
export class FileItemModVideoCover extends FileItemModBase {
  readonly SETTING_KEYS = ['enableFilelistPreview'] as const

  private container: HTMLDivElement | null = null
  private vueApp: App | null = null
  private visibilityObserver: IntersectionObserver | null = null
  private stopPreloadWatch: (() => void) | null = null

  onLoad() {
    logger.info('开始加载旧版页面视频封面')

    // 如果文件列表类型为网格，则不加载
    if (this.itemInfo.fileListType === FileListType.grid) {
      return
    }

    // 如果视频不是视频，则不加载
    if (this.itemInfo.attributes.iv !== IvType.Yes) {
      return
    }

    this.itemNode.classList.add('with-ext-video-cover')

    /** 创建容器元素 */
    const container = document.createElement('div')
    container.style.width = '100%'
    container.setAttribute('data-115master-preview', '')
    container.setAttribute(
      'data-115master-pick-code',
      this.itemInfo.attributes.pick_code,
    )
    this.itemNode.append(container)
    this.container = container

    /*
     * ================================================================================
     * 步骤1：延迟挂载视口外视频预览
     * ================================================================================
     * 目标：旧版大目录开启预览时只创建视口附近的 Vue 与 Shadow DOM。
     * 数据源：视频预览占位节点和文件列表滚动容器。
     * 操作：
     * 1) 坐标已进入 600px 预加载区时立即挂载
     * 2) 其余项目复用可见性观察和共享滚动兜底
     */
    logger.info('开始监听视频预览可见区域', this.itemInfo.attributes.pick_code)

    const ownerWindow = container.ownerDocument.defaultView
    const Observer = ownerWindow?.IntersectionObserver
    if (!Observer) {
      this.mountApp()
      logger.info('视频预览可见区域监听完成，使用即时挂载', this.itemInfo.attributes.pick_code)
      return
    }

    const scrollBox = this.itemInfo.listScrollBoxNode
    if (isWithinFileItemPreloadRange(container, scrollBox)) {
      this.mountApp()
      logger.info('视频预览可见区域监听完成，使用坐标即时挂载', this.itemInfo.attributes.pick_code)
      return
    }

    const root = scrollBox instanceof Element && scrollBox.contains(container)
      ? scrollBox
      : null
    const mount = () => {
      this.visibilityObserver?.disconnect()
      this.visibilityObserver = null
      this.stopPreloadWatch?.()
      this.stopPreloadWatch = null
      this.mountApp()
    }
    this.visibilityObserver = new Observer((entries) => {
      if (entries.some(entry => entry.isIntersecting))
        mount()
    }, {
      root,
      rootMargin: `${FILE_ITEM_PRELOAD_MARGIN}px 0px`,
    })
    this.visibilityObserver.observe(container)
    this.stopPreloadWatch = watchFileItemPreloadRange(container, scrollBox, mount)
    logger.info('视频预览可见区域监听完成', this.itemInfo.attributes.pick_code)
  }

  onDestroy() {
    logger.info('开始卸载旧版页面视频封面')
    this.visibilityObserver?.disconnect()
    this.visibilityObserver = null
    this.stopPreloadWatch?.()
    this.stopPreloadWatch = null
    this.vueApp?.unmount()
    this.vueApp = null
    this.container?.remove()
    this.container = null
    this.itemNode.classList.remove('with-ext-video-cover')
    logger.info('旧版页面视频封面卸载完成')
  }

  private mountApp() {
    if (this.vueApp || !this.container?.isConnected)
      return

    /*
     * ================================================================================
     * 步骤2：挂载可见视频预览
     * ================================================================================
     * 目标：进入预加载范围后再创建预览应用和隔离样式。
     * 数据源：当前视频信息和预览占位节点。
     * 操作：
     * 1) 创建 Shadow DOM 与主题挂载点
     * 2) 挂载 ExtVideoCover
     */
    logger.info('开始挂载可见视频预览', this.itemInfo.attributes.pick_code)

    /** 创建 shadow DOM */
    const shadowRoot = this.container.attachShadow({ mode: 'open' })

    /** 在 shadow DOM 中添加样式 */
    const styleElement = document.createElement('style')
    styleElement.textContent = mainStyles
    shadowRoot.appendChild(styleElement)

    /** 在 shadow DOM 中创建挂载点，data-theme 跟随应用当前主题 */
    const root = document.createElement('div')
    root.className = 'ext-video-cover-root'
    const appRoot = this.container.ownerDocument.getElementById('my-app')
    const theme = this.itemInfo.surface === 'official'
      ? 'light'
      : appRoot?.getAttribute('data-theme') || 'dark'
    root.setAttribute('data-theme', theme)
    shadowRoot.appendChild(root)

    /** 创建并挂载 Vue 应用 */
    const app = createApp(ExtVideoCover, {
      pickCode: this.itemInfo.attributes.pick_code,
      sha1: this.itemInfo.attributes.sha1,
      duration: String(this.itemInfo.duration),
      listScrollBoxNode: this.itemInfo.listScrollBoxNode,
      variant: this.itemInfo.surface === 'official'
        ? this.itemInfo.presentation === 'panel'
          ? 'official-panel'
          : 'official'
        : 'legacy',
    })
    app.mount(root)
    this.vueApp = app
    logger.info('可见视频预览挂载完成', this.itemInfo.attributes.pick_code)
  }
}
