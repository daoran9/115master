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

    this.itemNode.classList.add('with-actress-info')
    const actressDom = document.createElement('img')
    actressDom.alt = actress.filename
    actressDom.loading = 'lazy'
    actressDom.className = 'actress-info-img'
    this.itemNode.querySelector('.file-name-wrap')?.prepend(actressDom)
    this.actressDom = actressDom

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
    this.itemNode.classList.remove('with-actress-info')
    if (this.objectUrl)
      URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
    logger.info('旧版页面演员头像卸载完成')
  }
}
