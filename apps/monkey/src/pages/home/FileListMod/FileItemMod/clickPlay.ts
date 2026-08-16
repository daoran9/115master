import { GM_openInTab } from '$'
import { Share } from '@115master/drive115'

import { IvType } from '@/pages/home/types'
import { appLogger } from '@/utils/logger'
import { goToPlayer } from '@/utils/route'
import { FileItemModBase } from './base'

const INTERACTIVE_SELECTOR = 'button, input, textarea, select, [role="button"], [draggable="true"]'

/**
 * FileItemMod 点击播放
 */
export class FileItemModClickPlay extends FileItemModBase {
  private readonly logger = appLogger.sub('FileItemModClickPlay')

  /** 文件名节点 */
  get fileNameNode() {
    const root = this.itemInfo.interactionNode ?? this.itemNode
    return (
      root.querySelector('.file-thumb')
      ?? root.querySelector('.file-name .name')
      ?? root.querySelector('.file-name-responsive')
    )
  }

  /** 加载 */
  onLoad() {
    // 如果文件不是视频，则不进行操作
    if (this.itemInfo.attributes.iv !== IvType.Yes) {
      return
    }

    /*
     * ================================================================================
     * 步骤1：绑定视频文件名播放交互
     * ================================================================================
     * 目标：保留旧版单击、双击和中键播放，同时避免拦截新版原生行控件。
     * 数据源：新版原生文件名节点或旧版文件项节点。
     * 操作：
     * 1) 文件名单击和双击打开 Fusion 播放器
     * 2) 视频文件名中键打开 115 官方播放器
     */
    this.logger.info('开始绑定视频文件名播放交互')
    const root = this.itemInfo.interactionNode ?? this.itemNode

    // 1.1 单击只绑定文件名，不接管新版行空白区域。
    this.fileNameNode?.addEventListener(
      'click',
      this.handleClickPlayer,
      true,
    )

    if (this.itemInfo.surface === 'official') {
      // 1.2 新版只接管文件名双击和中键。
      this.fileNameNode?.addEventListener('dblclick', this.handleClickPlayer)
      this.fileNameNode?.addEventListener('auxclick', this.handleAuxclick)
    }
    else {
      // 1.3 旧版保留整行双击和中键兼容行为。
      root.addEventListener('dblclick', this.handleClickPlayer)
      root.addEventListener('auxclick', this.handleAuxclick)
    }

    this.logger.info('视频文件名播放交互绑定完成')
  }

  /** 销毁 */
  onDestroy() {
    this.logger.info('开始解绑视频文件名播放交互')
    const root = this.itemInfo.interactionNode ?? this.itemNode
    this.fileNameNode?.removeEventListener(
      'click',
      this.handleClickPlayer,
      true,
    )
    if (this.itemInfo.surface === 'official') {
      this.fileNameNode?.removeEventListener('dblclick', this.handleClickPlayer)
      this.fileNameNode?.removeEventListener('auxclick', this.handleAuxclick)
    }
    else {
      root.removeEventListener('dblclick', this.handleClickPlayer)
      root.removeEventListener('auxclick', this.handleAuxclick)
    }
    this.logger.info('视频文件名播放交互解绑完成')
  }

  /** 中键文件115播放 */
  private readonly handleAuxclick = (event: Event) => {
    if (!(event instanceof MouseEvent) || event.button !== 1 || this.isUnsafeTarget(event))
      return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    GM_openInTab(
      new URL(
        `/?pickcode=${this.itemInfo.attributes.pick_code}&share_id=0`,
        Share.CONSTANT.URL_115.VOD,
      ).href,
      { active: true },
    )
    this.logger.info('115 官方播放器已打开', this.itemInfo.attributes.pick_code)
  }

  /** 点击文件名 master 播放 */
  private readonly handleClickPlayer = (e: Event) => {
    if (this.isUnsafeTarget(e))
      return

    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    goToPlayer(
      {
        pickCode: this.itemInfo.attributes.pick_code,
      },
      true,
    )
    this.logger.info('Fusion 播放器已打开', this.itemInfo.attributes.pick_code)
  }

  /** 只允许文件名本身触发播放，跳过新版原生控件和拖拽节点。 */
  private isUnsafeTarget(event: Event): boolean {
    const target = event.target
    return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR))
  }
}
