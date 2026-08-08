import type { TopRootSearchParams } from '@/pages/home/global'
import { unsafeWindow } from '$'
import { I } from '@/icons'
import { BaseMod } from '@/pages/home/BaseMod'
import { appLogger } from '@/utils/logger'
import { getUrlParams } from '@/utils/url'
import { userSettings } from '@/utils/userSettings'
import { openOfflineTask } from './openOfflineTask'
import './index.css'
import 'iconify-icon'

/**
 * 顶部导航栏修改器
 * @description
 * 1. 添加自定义的云下载一级按钮
 * 2. 删除官方的云下载按钮
 * 3. 云下载按钮免除刷新重定向
 * 4. 添加预览切换开关
 */
export class TopHeaderMod extends BaseMod {
  private readonly logger = appLogger.sub('TopHeaderMod')
  private menuObserver: ResizeObserver | null = null
  private menuFrame: number | null = null

  constructor() {
    super()
    this.init()
  }

  /** 顶部导航栏节点 */
  get topHeaderNode() {
    return document.querySelector(unsafeWindow.Main.CONFIG.TopPanelBox)
      ?.firstElementChild as HTMLElement
  }

  /** 销毁 */
  destroy() {
    /*
     * ================================================================================
     * 步骤1：释放顶栏增强
     * ================================================================================
     * 目标：页面重绘或路由切换后不残留观察器与重复按钮。
     * 操作：
     * 1) 停止尺寸监听并取消待处理的布局任务
     * 2) 移除 Fusion 注入的顶栏按钮
     */
    this.logger.info('开始释放旧版页面顶栏增强')

    this.menuObserver?.disconnect()
    this.menuObserver = null
    if (this.menuFrame !== null)
      cancelAnimationFrame(this.menuFrame)
    this.menuFrame = null
    this.topHeaderNode?.querySelector('.master-offline-task-btn')?.remove()
    this.topHeaderNode?.querySelector('.master-preview-switch-btn')?.remove()

    this.logger.info('旧版页面顶栏增强释放完成')
  }

  /** 初始化 */
  private init() {
    if (!this.topHeaderNode)
      return
    const params = getUrlParams<TopRootSearchParams>(
      top?.window.location.search ?? '',
    )
    if (params.mode === 'search') {
      return
    }
    this.deleteOfficialDownloadButton()
    this.addMasterOfflineTaskButton()
    this.addPreviewSwitchButton()
    this.watchContextMenuPosition()
  }

  /** 删除官方的离线任务按钮 */
  private deleteOfficialDownloadButton() {
    const downloadButton = this.topHeaderNode?.querySelector(
      '.button[menu=\'offline_task\']',
    )
    if (downloadButton) {
      downloadButton.remove()
    }
  }

  /** 添加 Master 离线任务按钮 */
  private addMasterOfflineTaskButton() {
    const button = this.createMasterOfflineTaskButton()
    this.topHeaderNode?.prepend(button)
  }

  /** 创建 Master 离线任务按钮 */
  private createMasterOfflineTaskButton() {
    const button = document.createElement('a')
    button.classList.add('button', 'master-offline-task-btn')
    button.href = 'javascript:void(0)'
    button.innerHTML = `
            <i class="icon-operate ifo-linktask"></i>
            <span>云下载</span>
        `
    button.style.background = 'var(--official-theme)'
    button.style.borderColor = 'var(--official-theme)'
    button.style.color = '#fff'
    button.onclick = () => {
      openOfflineTask()
    }
    return button
  }

  /** 添加预览切换开关 */
  private addPreviewSwitchButton() {
    const button = this.createPreviewSwitchButton()
    this.topHeaderNode?.append(button)
  }

  /** 创建预览切换开关 */
  private createPreviewSwitchButton() {
    const value = userSettings.value.enableFilelistPreview
    const button = document.createElement('a')
    button.classList.add('button', 'btn-line', 'master-preview-switch-btn')
    if (value) {
      button.classList.add('active')
    }
    button.setAttribute('title', '开启文件预览')
    button.href = 'javascript:void(0)'
    button.innerHTML = `
      <iconify-icon class="preview-off" icon="${I.PREVIEW_OFF}" noobserver></iconify-icon>
      <iconify-icon class="preview-on" icon="${I.PREVIEW_ON}" noobserver></iconify-icon>
    `
    button.onclick = () => {
      userSettings.value.enableFilelistPreview
        = !userSettings.value.enableFilelistPreview
      button.classList.toggle('active')
    }
    return button
  }

  /** 修正右键菜单位置 */
  private fixContextMenuPosition(name: string) {
    const tabNode = document.querySelector<HTMLElement>(
      `[data-dropdown-tab="${name}"]`,
    )
    const contextMenuNode = document.querySelector<HTMLElement>(
      `[data-dropdown-content="${name}"]`,
    )
    if (!tabNode || !contextMenuNode)
      return
    const tabRect = tabNode.getBoundingClientRect()
    contextMenuNode.style.left = `${tabRect.left}px`
  }

  /** 跟随顶栏布局变化修正下拉菜单位置。 */
  private watchContextMenuPosition() {
    /*
     * ================================================================================
     * 步骤1：监听顶栏布局
     * ================================================================================
     * 目标：图标、字体或新版官方 DOM 延迟布局后，下拉菜单仍对齐触发按钮。
     * 操作：
     * 1) 用 ResizeObserver 捕获顶栏尺寸变化
     * 2) 在下一帧统一重算上传与新建菜单坐标
     */
    this.logger.info('开始监听旧版页面顶栏布局')

    const update = () => {
      if (this.menuFrame !== null)
        cancelAnimationFrame(this.menuFrame)
      this.menuFrame = requestAnimationFrame(() => {
        this.fixContextMenuPosition('upload_btn_add_dir')
        this.fixContextMenuPosition('create_new_add_dir')
        this.menuFrame = null
      })
    }

    this.menuObserver = new ResizeObserver(update)
    this.menuObserver.observe(this.topHeaderNode)
    update()

    this.logger.info('旧版页面顶栏布局监听完成')
  }
}
