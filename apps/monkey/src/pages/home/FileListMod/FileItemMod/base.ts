import type { ItemInfo } from '@/pages/home/types'
import type { UserSettingKey } from '@/utils/userSettings'
import { appLogger } from '@/utils/logger'
import { userSettings } from '@/utils/userSettings'

/** 文件项增强共用生命周期日志，避免每个列表项注册子 logger。 */
const lifecycleLogger = appLogger.sub('FileItemModBase')

/**
 * 文件列表 Item 修改器基类
 */
export abstract class FileItemModBase {
  /** 影响当前 Mod 启停的用户设置。 */
  readonly SETTING_KEYS: readonly UserSettingKey[] = []
  private active = false
  private disposers: Array<() => void> = []
  private initialized = false

  /**
   * 构造函数
   * @param itemNode item dom
   * @param itemInfo item 信息
   */
  constructor(
    readonly itemNode: HTMLElement,
    readonly itemInfo: ItemInfo,
  ) {}

  /** 加载 */
  load() {
    if (this.initialized)
      return
    this.initialized = true

    /**
     * ================================================================================
     * 步骤1：绑定运行时功能开关
     * ================================================================================
     * 目标：替代 Plus 编译门控，让旧版增强可随设置实时启停。
     * 操作：
     * 1) 按当前设置同步 Mod 状态
     * 2) 监听相关设置并增量切换
     */
    lifecycleLogger.info('开始绑定文件项增强设置', this.constructor.name)

    this.sync()
    this.disposers = this.SETTING_KEYS.map(key =>
      userSettings.watch(key, () => this.sync()),
    )

    lifecycleLogger.info('文件项增强设置绑定完成', this.constructor.name)
  }

  /** 销毁 */
  destroy() {
    if (!this.initialized)
      return

    lifecycleLogger.info('开始销毁文件项增强', this.constructor.name)
    this.disposers.forEach(dispose => dispose())
    this.disposers = []
    this.setActive(false)
    this.initialized = false
    lifecycleLogger.info('文件项增强销毁完成', this.constructor.name)
  }

  /** 当前设置是否允许加载。 */
  protected isEnabled(): boolean {
    return this.SETTING_KEYS.every(key => Boolean(userSettings.value[key]))
  }

  /** 同步当前激活状态。 */
  private sync(): void {
    this.setActive(this.isEnabled())
  }

  /** 切换当前激活状态。 */
  private setActive(active: boolean): void {
    if (this.active === active)
      return

    this.active = active
    const task = active ? this.onLoad() : this.onDestroy()
    Promise.resolve(task).catch((error) => {
      this.active = false
      lifecycleLogger.error('切换文件项增强失败', this.constructor.name, error)
    })
  }

  /** 加载时 */
  abstract onLoad(): Promise<void> | void
  /** 销毁时 */
  abstract onDestroy(): Promise<void> | void
}

/**
 * 文件列表 Item 修改器类型
 */
export type FileListMod = new (
  itemNode: HTMLElement,
  itemInfo: ItemInfo,
) => FileItemModBase
