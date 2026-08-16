import { throttle } from 'lodash'
import { appLogger } from '@/utils/logger'

const STORAGE_KEY = '115_master_official_scroll_history'

/** 新版 115 文件页滚动位置记录。 */
export class OfficialScrollHistory {
  private readonly logger = appLogger.sub('OfficialScrollHistory')
  private activeKey = ''
  private activeLocation = ''
  private scrollBox: HTMLElement | null = null
  private readonly handleScroll = throttle(
    () => this.saveCurrent(),
    1000 / 30,
    { leading: true, trailing: true },
  )

  /** 绑定当前路由和视图使用的滚动容器。 */
  sync(scrollBox: HTMLElement, key: string): void {
    if (this.scrollBox === scrollBox && this.activeKey === key)
      return

    /*
     * ================================================================================
     * 步骤1：切换新版滚动记录目标
     * ================================================================================
     * 目标：目录、特殊列表和视图切换时分别保存滚动位置。
     * 数据源：当前滚动容器与 pathname、search、视图组成的稳定 key。
     * 操作：
     * 1) 保存并解绑上一个目标
     * 2) 绑定新目标并恢复会话内位置
     */
    this.logger.info('开始切换新版滚动记录目标', key)

    /** 1.1 只有更换滚动节点时才补存；同节点切路由可能已被 React 归零。 */
    if (this.scrollBox && this.scrollBox !== scrollBox)
      this.saveCurrent()
    this.scrollBox?.removeEventListener('scroll', this.handleScroll)

    /** 1.2 绑定新目标，并在当前 React 布局完成后恢复位置。 */
    this.scrollBox = scrollBox
    this.activeKey = key
    this.activeLocation = `${window.location.pathname}${window.location.search}`
    this.scrollBox.addEventListener('scroll', this.handleScroll, { passive: true })
    requestAnimationFrame(() => this.restoreCurrent())

    this.logger.info('新版滚动记录目标切换完成', key)
  }

  /** 销毁监听；保留 sessionStorage 中的历史。 */
  destroy(): void {
    /*
     * ================================================================================
     * 步骤2：销毁新版滚动记录器
     * ================================================================================
     * 目标：释放事件和节流定时器，同时保留本次会话历史。
     * 操作：
     * 1) 保存当前位置
     * 2) 解绑监听并取消尾调用
     */
    this.logger.info('开始销毁新版滚动记录器')

    // 2.1 保存销毁前的最后位置。
    this.saveCurrent()

    // 2.2 只清理监听，不删除用户仍可能返回的目录记录。
    this.scrollBox?.removeEventListener('scroll', this.handleScroll)
    this.handleScroll.cancel()
    this.scrollBox = null
    this.activeKey = ''
    this.activeLocation = ''

    this.logger.info('新版滚动记录器销毁完成')
  }

  /** 保存当前目标的位置。 */
  private saveCurrent(): void {
    if (
      !this.scrollBox
      || !this.activeKey
      || this.activeLocation !== `${window.location.pathname}${window.location.search}`
    ) {
      return
    }

    const history = this.readHistory()
    history[this.activeKey] = this.scrollBox.scrollTop
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  }

  /** 恢复当前目标的位置。 */
  private restoreCurrent(): void {
    if (!this.scrollBox || !this.activeKey)
      return

    const position = this.readHistory()[this.activeKey] ?? 0
    if (position > 0)
      this.scrollBox.scrollTo({ top: position, behavior: 'instant' })
  }

  /** 容错读取当前会话历史。 */
  private readHistory(): Record<string, number> {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')
    }
    catch (error) {
      this.logger.warn('新版滚动历史读取失败，已使用空记录', error)
      return {}
    }
  }
}
