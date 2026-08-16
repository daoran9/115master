import type { FileItemModBase, FileListMod } from './FileItemMod/base'
import type { FileItemAttributes, FileListType, ItemInfo } from '@/pages/home/types'
import { time } from '@115master/utils'
import { getAvNumber } from '@/utils/getNumber'

/**
 * 文件列表 Item 修改加载器
 */
export class FileItemModLoader {
  /** 已加载的修改器 */
  private loadedMods: FileItemModBase[] = []

  constructor(
    /** item 节点 DOM */
    private readonly itemNode: HTMLElement,
    /** 文件列表类型 */
    private readonly fileListType: FileListType,
    /** 列表滚动容器 DOM */
    private readonly listScrollBoxNode: HTMLElement,
    /** 加载的 item 修改器类 */
    private readonly mods: Array<FileListMod>,
    /** 新版官方页面可直接提供已转换的文件信息。 */
    private readonly providedItemInfo?: ItemInfo,
  ) {}

  /** 获取属性 */
  private get attributes(): FileItemAttributes {
    return Object.fromEntries(
      Array.from(this.itemNode.attributes).map(attr => [
        attr.name,
        attr.value,
      ]),
    ) as unknown as FileItemAttributes
  }

  /** 获取番号 */
  private get avNumber(): ItemInfo['avNumber'] {
    return getAvNumber(this.attributes.title)
  }

  /** 获取视频时长节点 */
  private get durationNode(): HTMLElement | null {
    return this.itemNode.querySelector('.duration') ?? null
  }

  /** 获取视频时长 */
  private get duration(): number {
    return time.getDuration(this.durationNode?.getAttribute('duration') ?? '')
  }

  /** itemInfo */
  private get itemInfo(): ItemInfo {
    if (this.providedItemInfo)
      return this.providedItemInfo

    return {
      avNumber: this.avNumber,
      attributes: this.attributes,
      fileListType: this.fileListType,
      duration: this.duration,
      listScrollBoxNode: this.listScrollBoxNode,
      surface: 'legacy',
    }
  }

  /** 加载 */
  async load() {
    this.mods.forEach((Mod) => {
      const mod = new Mod(this.itemNode, this.itemInfo)
      mod.load()
      this.loadedMods.push(mod)
    })
  }

  /** 销毁 */
  destroy() {
    this.loadedMods.forEach((mod) => {
      mod.destroy()
    })
  }
}
