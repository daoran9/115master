import { unsafeWindow } from '$'
import { Core } from '@115master/drive115'
import { drive115 } from '@/utils/drive115Instance'
import { appLogger } from '@/utils/logger'
import { is115Browser } from '@/utils/platform'
import { FileItemModBase } from './base'

const logger = appLogger.sub('FileItemModDownload')
const NATIVE_ACTION_GROUP_SELECTOR = '[data-115master-native-action-group]'

/**
 * FileItemMod 文件下载
 */
export class FileItemModDownload extends FileItemModBase {
  private previousDirOnClick: GlobalEventHandlers['onclick'] = null
  private previousFileOnClick: GlobalEventHandlers['onclick'] = null

  get fileOprNode() {
    const interactionRoot = this.itemInfo.surface === 'official'
      ? this.itemInfo.interactionNode ?? this.itemNode
      : this.itemNode
    const mergedActions = interactionRoot.querySelector<HTMLElement>('[data-115master-merged-actions]')
    return mergedActions?.querySelector<HTMLElement>(NATIVE_ACTION_GROUP_SELECTOR)
      ?? mergedActions
      ?? this.itemNode.querySelector<HTMLElement>('.file-opr')
  }

  get downloadOneNode() {
    return this.fileOprNode?.querySelector<HTMLElement>(
      'a[menu="download_one"]',
    )
  }

  get downloadDirOneNode() {
    return this.fileOprNode?.querySelector<HTMLElement>(
      'a[menu="download_dir_one"]',
    )
  }

  onLoad() {
    /*
     * ================================================================================
     * 步骤1：接管单文件下载入口
     * ================================================================================
     * 目标：旧版保留原规则；新版合成操作栏在 115Browser 中也能下载。
     * 数据源：文件行 .file-opr 下载按钮和 pick code。
     * 操作：
     * 1) 保存原点击处理器
     * 2) 用 drive115 下载接口打开真实地址
     */
    logger.info('开始绑定文件行下载入口')

    if (!this.fileOprNode) {
      logger.info('文件行下载入口绑定完成，无操作栏')
      return
    }

    const isSyntheticActions = this.fileOprNode.hasAttribute('data-115master-native-actions')
    if (is115Browser && !isSyntheticActions) {
      logger.info('文件行下载入口绑定完成，保留 115Browser 原生下载')
      return
    }

    if (this.downloadDirOneNode) {
      this.previousDirOnClick = this.downloadDirOneNode.onclick
      this.downloadDirOneNode.onclick = async (e) => {
        e.stopImmediatePropagation()
        e.preventDefault()

        /*
         * ================================================================================
         * 步骤2：创建 115Browser 文件夹下载任务
         * ================================================================================
         * 目标：新版 Fusion 独立入口复用 115Browser 原生批量下载能力。
         * 数据源：文件夹名称、pick code、shortcut code 和当前页面地址。
         * 操作：
         * 1) 校验 115Browser 接口
         * 2) 编码单文件夹任务并交给 CreateDownloadTask
         */
        logger.info('开始创建 115Browser 文件夹下载任务')

        const browserInterface = (unsafeWindow as unknown as {
          browserInterface?: {
            CreateDownloadTask?: (payload: string) => void
          }
        }).browserInterface
        if (!is115Browser || !browserInterface?.CreateDownloadTask) {
          alert('文件夹下载需要 115Browser')
          logger.info('115Browser 文件夹下载任务创建结束，接口不可用')
          return
        }

        /** 2.1 字段与 115 新版 buildBrowserDownloadData 保持一致。 */
        const payload = {
          list: [{
            n: this.itemInfo.attributes.title,
            pc: this.itemInfo.attributes.pick_code,
            is_dir: true,
            sc: this.itemInfo.attributes.download_sc,
          }],
          count: 1,
          ref_url: window.location.href,
        }
        browserInterface.CreateDownloadTask(
          encodeURIComponent(JSON.stringify(payload)),
        )
        logger.info('115Browser 文件夹下载任务创建完成')
      }
    }

    if (this.downloadOneNode) {
      this.previousFileOnClick = this.downloadOneNode.onclick
      this.downloadOneNode.onclick = async (e) => {
        e.stopImmediatePropagation()
        e.preventDefault()

        try {
          const res = await drive115.video.getFileDownloadUrl(
            this.itemInfo.attributes.pick_code,
          )
          if (res.url.url) {
            window.open(res.url.url, '_blank')
            return
          }

          throw new Error('下载失败')
        }
        catch (error: unknown) {
          // 911 已由全局拦截器打开原生验证弹窗，不再用 alert 遮挡它。
          if (
            error instanceof Core.Drive115Error
            && error.code === Core.Drive115ErrorCode.CaptchaRequired
          ) {
            return
          }

          if (error instanceof Error) {
            alert(error.message)
          }
          else {
            alert('下载失败')
          }
        }
      }
    }

    logger.info('文件行下载入口绑定完成')
  }

  onDestroy() {
    logger.info('开始解绑文件行下载入口')
    if (this.downloadDirOneNode)
      this.downloadDirOneNode.onclick = this.previousDirOnClick
    if (this.downloadOneNode)
      this.downloadOneNode.onclick = this.previousFileOnClick
    this.previousDirOnClick = null
    this.previousFileOnClick = null
    logger.info('文件行下载入口解绑完成')
  }
}
