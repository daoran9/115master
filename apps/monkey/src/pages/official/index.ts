import type { IconifyIcon } from 'iconify-icon'
import { MASTER_BASE_URL } from '@/constants'
import { appLogger } from '@/utils/logger'
import { userSettings } from '@/utils/userSettings'
import { officialIcons } from './icons'
import { NewOfficialFileListMod } from './newFileList'
import 'iconify-icon'

/**
 * 新版官方页面适配器。
 *
 * 原生文件列表保持只读；预览开关和 MASTER 入口由同一个隔离工具组承载。
 */
class OfficialPage {
  private readonly logger = appLogger.sub('OfficialPage')
  private fileListMod: NewOfficialFileListMod | null = null
  private host: HTMLDivElement | null = null
  private observer: MutationObserver | null = null
  private previewButton: HTMLButtonElement | null = null
  private previewIcon: HTMLElementTagNameMap['iconify-icon'] | null = null
  private previewDisposer: (() => void) | null = null
  private scheduledFrame: number | null = null
  private toolbarRetryAttempts = 0
  private toolbarRetryId: number | null = null

  constructor() {
    this.init()
  }

  /** 销毁页面入口。 */
  destroy(): void {
    /**
     * ================================================================================
     * 步骤1：销毁新版页面适配
     * ================================================================================
     * 目标：释放列表增强、工具组和所有监听器。
     * 操作：
     * 1) 停止 DOM 与设置监听
     * 2) 移除插件自有节点
     */
    this.logger.info('开始销毁新版页面适配')

    this.observer?.disconnect()
    this.observer = null
    if (this.scheduledFrame !== null)
      cancelAnimationFrame(this.scheduledFrame)
    this.scheduledFrame = null
    if (this.toolbarRetryId !== null)
      window.clearTimeout(this.toolbarRetryId)
    this.toolbarRetryId = null
    this.toolbarRetryAttempts = 0
    this.previewDisposer?.()
    this.previewDisposer = null
    this.fileListMod?.destroy()
    this.fileListMod = null
    this.host?.remove()
    this.host = null
    this.previewButton = null
    this.previewIcon = null

    this.logger.info('新版页面适配销毁完成')
  }

  /** 初始化页面入口。 */
  private init(): void {
    /*
     * ================================================================================
     * 步骤1：校验挂载环境
     * ================================================================================
     * 目标：只在顶层 115 页面启动新版适配。
     * 操作：
     * 1) 跳过 iframe
     * 2) 启动新版文件行增强
     */
    this.logger.info('开始校验新版页面适配环境')

    if (window.top !== window.self) {
      this.logger.info('新版页面适配已跳过 iframe')
      return
    }

    try {
      /** 1.1 将旧版行增强挂到新版原生文件列表。 */
      this.fileListMod = new NewOfficialFileListMod()
      this.logger.info('新版原生文件列表适配完成')
    }
    catch (error) {
      this.logger.error('新版原生文件列表适配失败', error)
    }

    /*
     * ================================================================================
     * 步骤2：创建隔离工具组
     * ================================================================================
     * 目标：用一个清晰、可靠的工具组承载预览开关和 MASTER 入口。
     * 数据源：本地 Ionicons 图标与 USER_SETTINGS。
     * 操作：
     * 1) 创建带离线图标的预览按钮和 Fusion 入口
     * 2) 监听预览设置并同步选中状态
     */
    this.logger.info('开始创建新版页面工具组')

    const host = document.createElement('div')
    host.setAttribute('data-115master-controls', '')
    host.setAttribute('data-115master-version', __115MASTER_VERSION__)
    host.setAttribute('data-115master-launcher', '')
    const supportsPreview = window.location.pathname.startsWith('/storage/')
    if (supportsPreview)
      host.setAttribute('data-115master-preview-toggle-host', '')
    const root = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      :host {
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }

      :host([data-placement="toolbar"]) {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        vertical-align: middle;
      }

      :host([data-placement="floating"]) {
        position: fixed;
        right: max(16px, env(safe-area-inset-right));
        bottom: max(16px, env(safe-area-inset-bottom));
      }

      .controls {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      :host([data-placement="floating"]) .controls {
        padding: 5px;
        border: 1px solid #e3e8ef;
        border-radius: 6px;
        background: #fff;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
      }

      .control {
        display: inline-flex;
        height: 32px;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 12px;
        border: 1px solid #d4d9e1;
        border-radius: 4px;
        background: #fff;
        color: #27364a;
        font: 400 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease,
          color 120ms ease, box-shadow 120ms ease;
      }

      .control:hover {
        border-color: #8fb8f5;
        background: #f5f9ff;
        color: #1468d8;
      }

      .control:focus-visible {
        outline: 3px solid rgba(22, 119, 255, 0.24);
        outline-offset: 2px;
      }

      .preview.active {
        border-color: #8bb9fb;
        background: #eaf3ff;
        color: #1468d8;
      }

      .launcher {
        color: #1468d8;
      }

      iconify-icon {
        width: 17px;
        height: 17px;
        flex: 0 0 17px;
        font-size: 17px;
      }

      @media (max-width: 760px) {
        .control {
          width: 32px;
          padding: 0;
        }

        .label {
          display: none;
        }
      }
    `

    /** 2.1 只有新版存储页面创建预览开关，旧版顶层由 iframe 内真实开关负责。 */
    this.logger.info('开始判定当前页面预览入口', window.location.pathname)
    let preview: HTMLButtonElement | null = null
    let previewIcon: HTMLElementTagNameMap['iconify-icon'] | null = null
    if (supportsPreview) {
      preview = document.createElement('button')
      preview.type = 'button'
      preview.className = 'control preview'
      preview.setAttribute('data-115master-preview-toggle', '')
      previewIcon = this.createIcon(officialIcons.eye)
      const previewLabel = document.createElement('span')
      previewLabel.className = 'label'
      previewLabel.textContent = '预览'
      preview.append(previewIcon, previewLabel)
      preview.addEventListener('click', () => {
        userSettings.value.enableFilelistPreview
          = !userSettings.value.enableFilelistPreview
      })
    }
    this.logger.info('当前页面预览入口判定完成', supportsPreview)

    /** 2.2 创建 MASTER 独立文件页入口。 */
    const launcher = document.createElement('a')
    launcher.className = 'control launcher'
    launcher.href = `${MASTER_BASE_URL}/#/drive`
    launcher.title = '打开 115Master Fusion'
    launcher.ariaLabel = '打开 115Master Fusion'
    launcher.target = '_self'
    launcher.setAttribute('data-115master-launcher-link', '')
    const launcherLabel = document.createElement('span')
    launcherLabel.className = 'label'
    launcherLabel.textContent = 'Fusion'
    launcher.append(this.createIcon(officialIcons.rocket), launcherLabel)

    const controls = document.createElement('div')
    controls.className = 'controls'
    if (preview)
      controls.append(preview)
    controls.append(launcher)
    root.append(style, controls)
    this.host = host
    this.previewButton = preview
    this.previewIcon = previewIcon
    if (preview) {
      this.previewDisposer = userSettings.watch(
        'enableFilelistPreview',
        (_, enabled) => this.syncPreviewButton(enabled),
      )
      this.syncPreviewButton(userSettings.value.enableFilelistPreview)
    }
    this.attach()
    this.syncTitle()

    this.logger.info('新版页面工具组创建完成')

    /*
     * ================================================================================
     * 步骤3：守护工具组位置
     * ================================================================================
     * 目标：优先跟随“新建”按钮，并在新版页面重绘后自动恢复。
     * 操作：
     * 1) 按动画帧合并 DOM 变化
     * 2) 找不到工具栏时使用右下角兜底位置
     */
    this.logger.info('开始监听新版页面工具栏重绘')

    this.observer = new MutationObserver(() => this.scheduleAttach())
    this.observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    })

    this.logger.info('新版页面工具栏监听完成')
  }

  /** 创建使用本地图标数据的 Iconify 元素。 */
  private createIcon(data: IconifyIcon): HTMLElementTagNameMap['iconify-icon'] {
    const icon = document.createElement('iconify-icon')
    icon.noobserver = true
    icon.inline = true
    icon.icon = data
    icon.setAttribute('aria-hidden', 'true')
    return icon
  }

  /** 同步预览开关的图标、状态和提示。 */
  private syncPreviewButton(enabled: boolean): void {
    if (!this.previewButton || !this.previewIcon)
      return

    this.previewButton.classList.toggle('active', enabled)
    this.previewButton.setAttribute('aria-pressed', String(enabled))
    this.previewButton.setAttribute(
      'aria-label',
      enabled ? '关闭视频预览' : '开启视频预览',
    )
    this.previewButton.title = enabled ? '关闭视频预览' : '开启视频预览'
    this.previewIcon.icon = enabled ? officialIcons.eye : officialIcons.eyeOff
  }

  /** 把高频 DOM 变化合并为每帧最多一次位置同步。 */
  private scheduleAttach(): void {
    if (this.scheduledFrame !== null)
      return

    this.scheduledFrame = requestAnimationFrame(() => {
      this.scheduledFrame = null
      this.attach()
      this.syncTitle()
    })
  }

  /** 浮动回退后低频复查工具栏，覆盖 115 首屏无后续 DOM 变化的情况。 */
  private scheduleToolbarRetry(): void {
    /*
     * ================================================================================
     * 步骤4：复查新版工具栏
     * ================================================================================
     * 目标：新建按钮晚于脚本出现时，工具组仍能从右下角回到工具栏。
     * 数据源：当前工具组位置和新版新建按钮。
     * 操作：
     * 1) 每 500ms 最多复查 20 次
     * 2) 找到工具栏后立即停止计时器
     */
    this.logger.info('开始复查新版页面工具栏位置')

    if (
      !this.host
      || this.host.getAttribute('data-placement') === 'toolbar'
      || this.toolbarRetryId !== null
      || this.toolbarRetryAttempts >= 20
    ) {
      this.logger.info('新版页面工具栏位置无需继续复查')
      return
    }

    // 4.1 用有限次数低频复查补足 MutationObserver 的首屏时序空档。
    this.toolbarRetryAttempts += 1
    this.toolbarRetryId = window.setTimeout(() => {
      this.toolbarRetryId = null
      this.attach()
    }, 500)

    this.logger.info('新版页面工具栏位置复查已安排', this.toolbarRetryAttempts)
  }

  /** 从新版面包屑同步页面标题，不改动面包屑原生节点。 */
  private syncTitle(): void {
    /*
     * ================================================================================
     * 步骤4：同步新版页面标题
     * ================================================================================
     * 目标：恢复旧版按当前目录显示标题的能力。
     * 数据源：新版面包屑中带 title 的按钮。
     * 操作：
     * 1) 读取根目录按钮所在的横向路径容器
     * 2) 按旧版规则倒序拼接路径，只写 document.title
     */
    this.logger.info('开始同步新版页面标题')

    const root = Array.from(document.querySelectorAll<HTMLButtonElement>('button[title]'))
      .find(button => button.title.trim() === '根目录' && button.getBoundingClientRect().width > 0)
    const breadcrumb = root?.closest<HTMLElement>('[class*="overflow-x-auto"]')
    const paths = Array.from(
      breadcrumb?.querySelectorAll<HTMLButtonElement>('button[title]') ?? [],
    )
      .map(button => button.title.trim() || button.textContent?.trim() || '')
      .filter((path, index, all) => path.length > 0 && all.indexOf(path) === index)

    if (paths.length === 0) {
      this.logger.info('新版页面标题同步跳过，无面包屑')
      return
    }

    const titlePaths = paths.length > 1
      ? paths.filter(path => path !== '根目录')
      : paths
    const title = titlePaths.reverse().join(' < ')
    if (title && document.title !== title)
      document.title = title

    this.logger.info('新版页面标题同步完成', title)
  }

  /** 查找当前可见的 115“新建”按钮。 */
  private findToolbarAnchor(): HTMLElement | null {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]'),
    )
    return candidates.find((node) => {
      const label = node.textContent?.replace(/\s+/g, '').trim()
      const rect = node.getBoundingClientRect()
      return label === '新建' && rect.width > 0 && rect.height > 0
    }) ?? null
  }

  /** 找到“新建”按钮所属的顶层工具项，避免插入下拉按钮内部。 */
  private findToolbarMount(anchor: HTMLElement): HTMLElement {
    /**
     * ================================================================================
     * 步骤1：解析原生工具栏挂载层
     * ================================================================================
     * 目标：把插件工具组放到“新建”外层工具项后，不撑高原生按钮容器。
     * 数据源：“新建”按钮及其最多六层可见祖先节点。
     * 操作：
     * 1) 跳过只包裹下拉按钮的纵向容器
     * 2) 找到拥有同一水平行可见兄弟节点的工具项
     */
    let current = anchor

    /** 1.1 从按钮向上查找原生工具栏的直接子项。 */
    for (let depth = 0; depth < 6; depth += 1) {
      const parent = current.parentElement
      if (!parent || parent === document.body)
        break

      const currentRect = current.getBoundingClientRect()
      const hasHorizontalPeer = Array.from(parent.children).some((child) => {
        if (!(child instanceof HTMLElement) || child === current || child === this.host)
          return false

        const peerRect = child.getBoundingClientRect()
        if (peerRect.width <= 0 || peerRect.height <= 0)
          return false

        const verticalOverlap = Math.min(currentRect.bottom, peerRect.bottom)
          - Math.max(currentRect.top, peerRect.top)
        const horizontallySeparate = peerRect.right <= currentRect.left + 1
          || peerRect.left >= currentRect.right - 1
        return verticalOverlap > 0 && horizontallySeparate
      })

      /** 1.2 当前节点已有同排兄弟时，它就是应插入其后的工具项。 */
      if (hasHorizontalPeer)
        return current

      current = parent
    }

    return anchor
  }

  /** 把工具组放到“新建”后面，工具栏不存在时回退到 body。 */
  private attach(): void {
    if (!this.host || !document.body)
      return

    const anchor = this.findToolbarAnchor()
    const mount = anchor ? this.findToolbarMount(anchor) : null
    if (mount?.parentElement) {
      if (this.toolbarRetryId !== null)
        window.clearTimeout(this.toolbarRetryId)
      this.toolbarRetryId = null
      this.toolbarRetryAttempts = 0
      this.host.setAttribute('data-placement', 'toolbar')
      if (
        this.host.parentElement !== mount.parentElement
        || this.host.previousElementSibling !== mount
      ) {
        mount.insertAdjacentElement('afterend', this.host)
      }
      return
    }

    this.host.setAttribute('data-placement', 'floating')
    if (this.host.parentElement !== document.body)
      document.body.append(this.host)
    this.scheduleToolbarRetry()
  }
}

export default OfficialPage
