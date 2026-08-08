import { MASTER_BASE_URL } from '@/constants'
import { I } from '@/icons'
import { appLogger } from '@/utils/logger'
import 'iconify-icon'

/**
 * 新版或未知官方页面的兼容入口。
 *
 * 不读取官方 DOM 结构，只提供一个隔离的 MASTER 启动按钮。官方页面改版时，
 * 独立 SPA 仍可从固定地址打开。
 */
class OfficialPage {
  private readonly logger = appLogger.sub('OfficialPage')
  private host: HTMLDivElement | null = null
  private observer: MutationObserver | null = null

  constructor() {
    this.init()
  }

  /** 销毁页面入口。 */
  destroy(): void {
    this.observer?.disconnect()
    this.observer = null
    this.host?.remove()
    this.host = null
  }

  /** 初始化页面入口。 */
  private init(): void {
    /*
     * ================================================================================
     * 步骤1：校验挂载环境
     * ================================================================================
     * 目标：只在顶层 115 页面创建一次入口。
     * 操作：
     * 1) 跳过 iframe
     * 2) 复用已存在的入口
     */
    this.logger.info('开始校验新版页面入口挂载环境')

    if (window.top !== window.self || document.querySelector('[data-115master-launcher]')) {
      this.logger.info('新版页面入口无需重复挂载')
      return
    }

    /*
     * ================================================================================
     * 步骤2：创建隔离启动按钮
     * ================================================================================
     * 目标：不依赖官方类名和层级，稳定跳转到 MASTER 独立文件页。
     * 操作：
     * 1) 用 Shadow DOM 隔离官方样式
     * 2) 创建图标按钮并挂到页面右下角
     */
    this.logger.info('开始创建新版页面入口')

    const host = document.createElement('div')
    host.setAttribute('data-115master-launcher', '')
    const root = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      :host {
        position: fixed;
        right: max(16px, env(safe-area-inset-right));
        bottom: max(16px, env(safe-area-inset-bottom));
        z-index: 2147483646;
      }

      a {
        display: inline-flex;
        width: 48px;
        height: 48px;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 50%;
        background: #1677ff;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.24);
        color: #fff;
        text-decoration: none;
        transition: background-color 160ms ease, transform 160ms ease;
      }

      a:hover {
        background: #0958d9;
        transform: translateY(-1px);
      }

      a:focus-visible {
        outline: 3px solid rgba(22, 119, 255, 0.35);
        outline-offset: 3px;
      }

      iconify-icon {
        width: 24px;
        height: 24px;
        font-size: 24px;
      }
    `

    const link = document.createElement('a')
    link.href = `${MASTER_BASE_URL}/#/drive`
    link.title = '打开 115Master Fusion'
    link.ariaLabel = '打开 115Master Fusion'
    link.target = '_self'

    const icon = document.createElement('iconify-icon')
    icon.setAttribute('icon', I.ROCKET_LAUNCH)
    icon.setAttribute('noobserver', '')
    link.append(icon)
    root.append(style, link)
    this.host = host
    this.attach()

    /*
     * ================================================================================
     * 步骤3：守护新版页面入口
     * ================================================================================
     * 目标：新版 115 单页应用重绘 body 后，入口仍能自动恢复。
     * 操作：
     * 1) 监听文档子树变化
     * 2) 入口被移除时重新挂到当前 body
     */
    this.logger.info('开始监听新版页面 DOM 重绘')

    this.observer = new MutationObserver(() => this.attach())
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })

    this.logger.info('新版页面入口创建及监听完成')
  }

  /** 确保启动按钮挂在当前文档。 */
  private attach(): void {
    if (!this.host || this.host.isConnected || !document.body)
      return

    if (document.querySelector('[data-115master-launcher]'))
      return

    this.logger.info('开始挂载新版页面入口')
    document.body.append(this.host)
    this.logger.info('新版页面入口挂载完成')
  }
}

export default OfficialPage
