import { GM_openInTab } from '$'
import { Share } from '@115master/drive115'
import { FileType } from '@/pages/home/types'
import { appLogger } from '@/utils/logger'
import { FileItemModBase } from './base'

/**
 * FileItemModFolderLink 文件夹链接修改
 * @description 修改文件夹 a 标签链接（支持鼠标中键新标签打开）
 */
export class FileItemModFolderLink extends FileItemModBase {
  private readonly logger = appLogger.sub('FileItemModFolderLink')

  get fileNameNode() {
    const root = this.itemInfo.interactionNode ?? this.itemNode
    return root.querySelector('.file-name')
      ?? root.querySelector('.file-name-responsive')
  }

  get fileAtagNode() {
    return this.fileNameNode?.querySelector('a') as HTMLAnchorElement | null
  }

  onLoad() {
    if (this.itemInfo.attributes.file_type !== FileType.folder) {
      return
    }

    this.logger.info('开始适配文件夹链接')

    if (this.itemInfo.surface === 'official') {
      this.fileNameNode?.addEventListener('auxclick', this.handleOfficialAuxClick)
      this.logger.info('新版文件夹中键入口绑定完成')
      return
    }

    this.modLegacyFolderATagLink()
    this.logger.info('旧版文件夹链接适配完成')
  }

  onDestroy() {
    this.logger.info('开始卸载文件夹链接适配')
    this.fileNameNode?.removeEventListener('auxclick', this.handleOfficialAuxClick)
    this.logger.info('文件夹链接适配已卸载')
  }

  /** 新版文件夹中键打开原生目录页。 */
  private readonly handleOfficialAuxClick = (event: Event) => {
    if (!(event instanceof MouseEvent) || event.button !== 1)
      return

    event.preventDefault()
    event.stopPropagation()
    const url = new URL('/storage/allfiles', Share.CONSTANT.URL_115.NORMAL)
    url.searchParams.set('cid', this.itemInfo.attributes.cate_id)
    url.searchParams.set('mode', 'wangpan')
    GM_openInTab(url.href, { active: true })
    this.logger.info('新版文件夹已在新标签打开', url.href)
  }

  /** 修改旧版文件夹 a 标签链接。 */
  private modLegacyFolderATagLink() {
    const aNode = this.fileAtagNode
    if (!aNode) {
      return
    }

    if (aNode.href.includes('javascript:;')) {
      const newHref = new URL(
        `/?cid=${this.itemInfo.attributes.cate_id}&offset=0&tab=&mode=wangpan`,
        Share.CONSTANT.URL_115.NORMAL,
      ).href
      aNode.href = newHref
    }
  }
}
