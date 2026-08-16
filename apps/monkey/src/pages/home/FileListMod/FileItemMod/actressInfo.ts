import { image as imageUtil } from '@115master/utils'
import { FileListType } from '@/pages/home/types'
import { actressFaceDB } from '@/utils/actressFaceDB'
import { imageCache } from '@/utils/cache'
import { appLogger } from '@/utils/logger'
import { FileItemModBase } from './base'

/** 演员头像增强共用日志。 */
const logger = appLogger.sub('FileItemModActressInfo')

/**
 * FileItemMod 演员信息
 */
export class FileItemModActressInfo extends FileItemModBase {
  readonly SETTING_KEYS = ['enableActressFaces'] as const
  private actressDom: HTMLImageElement | null = null
  private actressContainer: HTMLElement | null = null
  private loadId = 0
  private objectUrl: string | null = null

  async onLoad() {
    const loadId = ++this.loadId
    logger.info('开始加载旧版页面演员头像')

    // 如果文件列表类型为网格，则不加载演员信息
    if (this.itemInfo.fileListType === FileListType.grid) {
      return
    }

    await actressFaceDB.init()
    const actress = await actressFaceDB.findActress(
      this.itemInfo.attributes.title.trim(),
    )
    if (!actress || loadId !== this.loadId) {
      logger.info('旧版页面演员头像加载完成，无匹配头像')
      return
    }

    const actressDom = document.createElement('img')
    actressDom.alt = actress.filename
    actressDom.loading = 'lazy'
    actressDom.className = 'actress-info-img'
    actressDom.setAttribute('data-115master-actress', '')
    /*
     * ================================================================================
     * 步骤1：按页面形态约束演员头像
     * ================================================================================
     * 目标：新旧页面统一复现旧版头像外观。
     * 数据源：文件项所属页面形态。
     * 操作：
     * 1) 固定为旧版 50×50 圆形头像
     * 2) 新版只改变挂载容器，不改变头像外观
     */
    logger.info('开始设置演员头像显示模式')

    // eslint-disable-next-line jsdoc/convert-to-jsdoc-comments -- 项目步骤注释使用编号行注释。
    // 1.1 识别新版 115 原生文件列表附加区。
    const isOfficialSurface = this.itemInfo.surface === 'official'
    const avatarSize = 50

    // 1.2 写入与页面形态对应的固定尺寸和缩放方式。
    actressDom.style.width = `${avatarSize}px`
    actressDom.style.height = `${avatarSize}px`
    actressDom.style.minWidth = `${avatarSize}px`
    actressDom.style.maxWidth = `${avatarSize}px`
    actressDom.style.flex = `0 0 ${avatarSize}px`
    actressDom.style.borderRadius = '50%'
    actressDom.style.objectFit = 'cover'
    logger.info('演员头像显示模式设置完成', isOfficialSurface ? 'official' : 'legacy')
    const nameContainer = this.itemInfo.surface === 'official'
      ? this.itemInfo.presentation === 'panel'
        ? this.itemNode.closest('[data-115master-grid-panel]')
          ?.querySelector<HTMLElement>('[data-115master-grid-panel-header]')
          ?? this.itemNode
        : this.itemNode
      : this.itemNode.querySelector<HTMLElement>('.file-name-wrap')
        ?? this.itemNode.querySelector('.file-name-responsive')?.parentElement
    const styleContainer = this.itemInfo.surface === 'official'
      ? nameContainer
      : this.itemNode
    styleContainer?.classList.add('with-actress-info')
    nameContainer?.prepend(actressDom)
    this.actressDom = actressDom
    this.actressContainer = styleContainer ?? null

    try {
      /** 尝试从缓存获取图片 */
      const cacheKey = `actress-face-${actress.url}`
      const cachedImage = await imageCache.get(cacheKey)

      if (cachedImage) {
        this.objectUrl = URL.createObjectURL(cachedImage.value)
        actressDom.src = this.objectUrl
      }
      else {
        actressDom.src = actress.url
        try {
          const response = await fetch(actress.url)
          if (response.ok) {
            const blob = await response.blob()

            /** 压缩图片后再缓存 */
            const compressedBlob = await imageUtil.compress(blob, {
              maxWidth: 200,
              maxHeight: 200,
              quality: 0.8,
              type: 'image/webp',
            })

            // 存储到imageCache中
            await imageCache.set(cacheKey, compressedBlob)
          }
        }
        catch (error) {
          logger.error('缓存演员头像失败:', error)
        }
      }
    }
    catch (error) {
      // 出错时直接使用原始URL
      logger.error('加载演员头像缓存失败:', error)
      actressDom.src = actress.url
    }

    logger.info('旧版页面演员头像加载完成')
  }

  onDestroy() {
    logger.info('开始卸载旧版页面演员头像')
    this.loadId += 1
    this.actressDom?.remove()
    this.actressDom = null
    this.actressContainer?.classList.remove('with-actress-info')
    this.actressContainer = null
    if (this.objectUrl)
      URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
    logger.info('旧版页面演员头像卸载完成')
  }
}
