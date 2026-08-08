import type { App } from 'vue'
import { createApp } from 'vue'
import ExtVideoCover from '@/pages/home/components/ExtVideoCover/index.vue'
import { FileListType, IvType } from '@/pages/home/types'
import mainStyles from '@/styles/main.css?inline'
import { appLogger } from '@/utils/logger'
import { userSettings } from '@/utils/userSettings'
import { FileItemModBase } from './base'

/** 视频封面增强共用日志。 */
const logger = appLogger.sub('FileItemModVideoCover')

/**
 * FileItemMod 视频封面
 */
export class FileItemModVideoCover extends FileItemModBase {
  readonly SETTING_KEYS = ['enableFilelistPreview', 'enableAvInfo'] as const

  private container: HTMLDivElement | null = null
  private vueApp: App | null = null

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
    this.itemNode.append(container)
    this.container = container

    /** 创建 shadow DOM */
    const shadowRoot = container.attachShadow({ mode: 'open' })

    /** 在 shadow DOM 中添加样式 */
    const styleElement = document.createElement('style')
    styleElement.textContent = mainStyles
    shadowRoot.appendChild(styleElement)

    /** 在 shadow DOM 中创建挂载点，data-theme 跟随应用当前主题 */
    const root = document.createElement('div')
    root.className = 'ext-video-cover-root'
    const appRoot = document.getElementById('my-app')
    root.setAttribute('data-theme', appRoot?.getAttribute('data-theme') || 'dark')
    shadowRoot.appendChild(root)

    /** 创建并挂载 Vue 应用 */
    const app = createApp(ExtVideoCover, {
      pickCode: this.itemInfo.attributes.pick_code,
      sha1: this.itemInfo.attributes.sha1,
      duration: String(this.itemInfo.duration),
      listScrollBoxNode: this.itemInfo.listScrollBoxNode,
    })
    app.mount(root)
    this.vueApp = app
    logger.info('旧版页面视频封面加载完成')
  }

  onDestroy() {
    logger.info('开始卸载旧版页面视频封面')
    this.vueApp?.unmount()
    this.vueApp = null
    this.container?.remove()
    this.container = null
    this.itemNode.classList.remove('with-ext-video-cover')
    logger.info('旧版页面视频封面卸载完成')
  }

  protected isEnabled(): boolean {
    return userSettings.value.enableFilelistPreview
      && (!this.itemInfo.avNumber || !userSettings.value.enableAvInfo)
  }
}
