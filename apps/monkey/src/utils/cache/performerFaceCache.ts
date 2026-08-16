import type { Actor } from '@/utils/jav/jav'
import { CacheCore } from '@115master/shared'
import { appLogger } from '@/utils/logger'
import { STORE_NAME } from './const'

const PERFORMER_FACE_CACHE_KEY = 'performer_face_cache'
const logger = appLogger.sub('PerformerFaceCache')

export interface PerformerFaceCacheValue {
  actor: Actor
  source: string
}

class PerformerFaceCache extends CacheCore<PerformerFaceCacheValue> {
  constructor() {
    super({
      name: STORE_NAME,
      storeName: PERFORMER_FACE_CACHE_KEY,
      logger,
    })
  }

  /** 按标准化演员名读取长期头像映射。 */
  async getByName(name: string): Promise<PerformerFaceCacheValue | null> {
    /*
     * ================================================================================
     * 步骤1：读取演员头像映射
     * ================================================================================
     * 目标：同一演员在其他影片中直接复用已验证头像。
     * 数据源：按来源和标准化演员名保存的 IndexedDB 记录。
     * 操作：
     * 1) 读取固定来源键
     * 2) 只返回带真实头像地址的完整记录
     */
    logger.info('开始读取演员头像映射', name)

    /** 1.1 来源放进键中，后续增加其他头像源时互不覆盖。 */
    const cached = await this.get(`MissAV:${name}`)
    const value = cached?.value
    const result = value?.actor.face ? value : null

    logger.info('演员头像映射读取完成', name, Boolean(result))
    return result
  }

  /** 按标准化演员名保存已核对的头像映射。 */
  async setByName(name: string, value: PerformerFaceCacheValue): Promise<void> {
    /*
     * ================================================================================
     * 步骤1：保存演员头像映射
     * ================================================================================
     * 目标：只有姓名门禁和演员页校验都通过的头像才进入长期缓存。
     * 数据源：MissAV 演员详情页解析结果。
     * 操作：
     * 1) 拒绝空姓名或空头像
     * 2) 写入来源隔离的缓存键
     */
    logger.info('开始保存演员头像映射', name)

    // 1.1 不完整记录不能污染后续影片。
    if (!name || !value.actor.face) {
      logger.info('演员头像映射保存完成，记录不完整', name)
      return
    }
    await this.set(`MissAV:${name}`, value)

    logger.info('演员头像映射保存完成', name)
  }
}

export const performerFaceCache = new PerformerFaceCache()
