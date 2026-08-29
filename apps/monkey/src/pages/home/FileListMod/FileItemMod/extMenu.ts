import { GM_openInTab } from '$'
import { Share } from '@115master/drive115'

import iinaIcon from '@/assets/icons/iina-icon.png'
import { FileListType, IvType } from '@/pages/home/types'
import { drive115 } from '@/utils/drive115Instance'
import { openEd2kDialog } from '@/utils/ed2k/browserDialog'
import { isMac } from '@/utils/platform'
import { goToPlayer } from '@/utils/route'
import { webLinkIINA } from '@/utils/weblink'
import { FileItemModBase } from './base'

const NATIVE_ACTION_GROUP_SELECTOR = '[data-115master-native-action-group]'

/**
 * 按钮配置
 */
interface ButtonConfig {
  /** 类名 */
  class: string
  /** 标题 */
  title: string
  /** 文本 */
  text: string
  /** 图标 */
  icon?: string
  /** 是否可见 */
  visible: boolean
  /** 点击事件 */
  click: () => void
}

/**
 * FileItemMod 扩展菜单
 */
export class FileItemModExtMenu extends FileItemModBase {
  private readonly createdLinks: HTMLAnchorElement[] = []

  /** 按钮配置 */
  get buttonConfig(): ButtonConfig[] {
    const buttons: ButtonConfig[] = [
      {
        class: '115-player',
        title: '使用【115官方播放器】',
        text: this.useLegacyLabels ? '5️⃣ 官方播放' : '官方播放',
        visible: this.itemInfo.attributes.iv === IvType.Yes,
        click: () => {
          GM_openInTab(
            new URL(
              `/?pickcode=${this.itemInfo.attributes.pick_code}&share_id=0`,
              Share.CONSTANT.URL_115.VOD,
            ).href,
            { active: true },
          )
        },
      },
      ...(isMac
        ? [
            {
              class: 'iina-player',
              title: '使用【iina】',
              text: this.useLegacyLabels ? '🎵 iina 播放' : 'IINA',
              icon: this.useLegacyLabels ? undefined : iinaIcon,
              visible: this.itemInfo.attributes.iv === IvType.Yes,
              click: async () => {
                try {
                  const download = await drive115.video.getFileDownloadUrl(
                    this.itemInfo.attributes.pick_code,
                  )
                  open(webLinkIINA(download))
                }
                catch {
                  alert('打开iina失败')
                }
              },
            },
          ]
        : []),
      {
        class: 'master-player',
        title: '使用【Master播放器】',
        text: this.useLegacyLabels ? '▶️ Master 播放' : 'Master 播放',
        visible: this.itemInfo.attributes.iv === IvType.Yes,
        click: () => {
          goToPlayer(
            {
              pickCode: this.itemInfo.attributes.pick_code,
            },
            true,
          )
        },
      },
      {
        class: 'ed2k-link',
        title: '生成 ED2K 链',
        text: 'ED2K',
        visible: this.itemInfo.attributes.iv === IvType.Yes
          && Number.isSafeInteger(Number(this.itemInfo.attributes.file_size))
          && Number(this.itemInfo.attributes.file_size) >= 0,
        click: () => {
          void openEd2kDialog({
            name: this.itemInfo.attributes.title,
            pickCode: this.itemInfo.attributes.pick_code,
            size: Number(this.itemInfo.attributes.file_size),
          })
        },
      },
    ]

    /*
     * ================================================================================
     * 步骤1：按页面原版顺序提供操作入口
     * ================================================================================
     * 目标：旧版播放入口保持 v0.5.0 顺序，新版维持当前 Fusion 顺序。
     * 数据源：页面 surface 和新增 ED2K 操作。
     * 操作：
     * 1) 旧版先创建 ED2K，使 prepend 后落到原版播放入口之后
     * 2) 新版沿用既有配置顺序
     */
    if (this.itemInfo.surface !== 'legacy')
      return buttons

    const ed2k = buttons[buttons.length - 1]
    return ed2k ? [ed2k, ...buttons.slice(0, -1)] : buttons
  }

  /** 文件操作节点 */
  get fileOprNode() {
    const interactionRoot = this.itemInfo.surface === 'official'
      ? this.itemInfo.interactionNode ?? this.itemNode
      : this.itemNode
    const mergedActions = interactionRoot.querySelector<HTMLElement>('[data-115master-merged-actions]')
    return mergedActions?.querySelector<HTMLElement>(NATIVE_ACTION_GROUP_SELECTOR)
      ?? mergedActions
      ?? this.itemNode.querySelector('.file-opr')
      ?? this.itemNode.querySelector('.file-opt')
  }

  /** 新旧页面统一沿用旧版文件操作入口的文字标记。 */
  private get useLegacyLabels(): boolean {
    return this.itemInfo.surface === 'legacy'
      || this.itemInfo.surface === 'official'
  }

  /** 加载 */
  onLoad() {
    // 如果文件列表类型为网格，则不加载扩展菜单
    if (this.itemInfo.fileListType === FileListType.grid) {
      return
    }

    this.createButtons()
  }

  /** 销毁 */
  onDestroy() {
    this.createdLinks.forEach(link => link.remove())
    this.createdLinks.length = 0
  }

  /** 创建文件操作菜单按钮 */
  private createButtons(): void {
    this.buttonConfig.forEach((button) => {
      if (!button.visible)
        return
      const link = this.createNormalItemButtonElement(button)
      this.fileOprNode?.prepend(link)
      this.createdLinks.push(link)
      link.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        button.click()
      })
    })
  }

  /** 创建普通文件项按钮元素 */
  private createNormalItemButtonElement(
    button: ButtonConfig,
  ): HTMLAnchorElement {
    const link = document.createElement('a')
    link.href = 'javascript:void(0)'
    link.className = button.class
    link.title = button.title
    link.style.cssText = `
      pointer-events: all;
      position: relative;
      z-index: var(--ui-z-host);
      display: flex;
      align-items: center;
      gap: 4px;
    `

    if (button.icon) {
      const icon = document.createElement('img')
      icon.src = button.icon
      icon.style.width = '16px'
      icon.style.height = '16px'
      link.prepend(icon)
    }

    const textSpan = document.createElement('span')
    textSpan.textContent = button.text
    textSpan.style.pointerEvents = 'none'
    link.appendChild(textSpan)
    return link
  }
}
