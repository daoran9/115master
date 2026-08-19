import type { Actor } from '@/utils/jav/jav'
import { promise } from '@115master/utils'
import { useAsyncState } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { actressFaceDB } from '@/utils/actressFaceDB'
import {
  Fd2Ppv,
  isFd2PpvAvNumber,
  JavBus,
  JavDB,
  JavLibrary,
  MissAV,
} from '@/utils/jav'
import { appLogger } from '@/utils/logger'
import { hasActorFace, normalizeActorName } from './actorFaces'

const logger = appLogger.sub('DataMovieInfo')

/** 按演员名读取文件列表共用的 gfriends 头像库。 */
async function loadGfriendsActorFaces(actorNames: string[]): Promise<Actor[]> {
  /*
   * ================================================================================
   * 步骤1：读取文件列表演员头像
   * ================================================================================
   * 目标：播放器复用文件列表已缓存的 gfriends 头像，补充影片资料站缺图。
   * 数据源：当前影片的演员名和 gfriends 文件树缓存。
   * 操作：
   * 1) 初始化共用头像库
   * 2) 按演员名并行读取头像并过滤未收录项
   */
  logger.info('开始读取文件列表演员头像', actorNames.length)

  try {
    // 1.1 复用文件列表的单例缓存；24 小时内不会重复下载文件树。
    await actressFaceDB.init()

    /** 1.2 只生成当前播放器演员的头像候选，不扫描或挂载文件列表。 */
    const actors: Actor[] = (await Promise.all(actorNames.map(async (name) => {
      const actress = await actressFaceDB.findActress(name)
      return actress
        ? { name, face: actress.url }
        : null
    }))).flatMap(actor => actor ? [actor] : [])

    logger.info('文件列表演员头像读取完成', actors.length)
    return actors
  }
  catch (error) {
    logger.warn('文件列表演员头像读取失败', error)
    logger.info('文件列表演员头像读取完成，回退远程来源')
    return []
  }
}

export function useDataMovieInfo() {
  const javDB = new JavDB()
  const javBus = new JavBus()
  const javLibrary = new JavLibrary()
  const missAV = new MissAV()
  const specialSourceName = ref<'FD2PPV' | null>(null)
  const gfriendsActorFaces = ref<Actor[]>([])
  const missAVActorFaces = ref<Actor[]>([])
  let currentAvNumber = ''
  let dataVersion = 0
  let gfriendsActorFaceLoadKey = ''
  let completedGfriendsActorFaceLoadKey = ''
  let gfriendsActorFaceLoad: Promise<void> | null = null
  const missAVActorFaceLoads = new Map<string, Promise<void>>()
  const completedMissAVActorFaceLoadKeys = new Set<string>()

  const javDBState = useAsyncState(
    async (avNumber?: string) => {
      if (!avNumber) {
        return null
      }
      const res = await javDB.getInfo(avNumber)
      await promise.promiseDelay(1000)
      return res
    },
    undefined,
    {
      immediate: false,
    },
  )

  const javBusState = useAsyncState(
    async (avNumber?: string) => {
      if (!avNumber) {
        return null
      }
      return javBus.getInfo(avNumber)
    },
    undefined,
    {
      immediate: false,
    },
  )

  const javLibraryState = useAsyncState(
    async (avNumber?: string) => {
      /*
       * ================================================================================
       * 步骤1：加载播放器 JavLibrary 资料
       * ================================================================================
       * 目标：给播放器提供可独立切换的第三个影片资料源。
       * 数据源：当前播放文件识别出的番号。
       * 操作：
       * 1) 空番号不发外部请求
       * 2) 有番号时读取 JavLibrary 详情
       */
      logger.info('开始加载播放器 JavLibrary 资料', avNumber)

      if (!avNumber) {
        logger.info('播放器 JavLibrary 资料加载完成，无番号')
        return null
      }
      const result = await javLibrary.getInfo(avNumber)

      logger.info('播放器 JavLibrary 资料加载完成', avNumber)
      return result
    },
    undefined,
    {
      immediate: false,
    },
  )

  const specialState = useAsyncState(
    async (avNumber?: string) => {
      /*
       * ================================================================================
       * 步骤1：加载播放器专用资料源
       * ================================================================================
       * 目标：FC2 使用 FD2PPV 专用来源。
       * 数据源：当前播放文件识别出的番号。
       * 操作：
       * 1) 按标识创建专用来源
       * 2) 读取该来源缓存或详情页
       */
      logger.info('开始加载播放器专用资料', specialSourceName.value, avNumber)

      // 1.1 未识别专用来源时不发外部请求。
      if (!avNumber || !specialSourceName.value) {
        logger.info('播放器专用资料加载完成，无专用来源')
        return null
      }

      /** 1.2 当前唯一专用来源是 FD2PPV。 */
      const source = new Fd2Ppv()
      const result = await source.getInfo(avNumber)

      logger.info('播放器专用资料加载完成', specialSourceName.value, avNumber)
      return result
    },
    undefined,
    {
      immediate: false,
    },
  )

  const sourceTabs = computed(() => {
    const regularTabs = [
      { key: 'javDBState', label: 'JavDB', state: javDBState },
      { key: 'javBusState', label: 'JavBus', state: javBusState },
      { key: 'javLibraryState', label: 'JavLibrary', state: javLibraryState },
    ]
    if (!specialSourceName.value)
      return regularTabs
    const specialTab = {
      key: 'specialState',
      label: specialSourceName.value,
      state: specialState,
    }
    return [specialTab, ...regularTabs]
  })

  const sourceActorNames = computed(() => Array.from(new Set(sourceTabs.value.flatMap(tab =>
    (tab.state.state.value?.actors ?? []).map(actor => actor.name.trim()).filter(Boolean)))))

  const preloadGfriendsActorFaces = (): Promise<void> => {
    /*
     * ================================================================================
     * 步骤1：预加载文件列表演员头像
     * ================================================================================
     * 目标：演员名出现后立即读取 gfriends，让它排在影片资料站头像之前。
     * 数据源：当前影片番号、已加载资料源的演员名和 gfriends 文件树缓存。
     * 操作：
     * 1) 合并相同影片和演员集合的重复请求
     * 2) 丢弃文件切换后的过期结果
     */
    logger.info('开始预加载文件列表演员头像', currentAvNumber)

    /** 1.1 没有当前影片或演员名时不读取头像库。 */
    const actorNames = sourceActorNames.value
    if (!currentAvNumber || actorNames.length === 0) {
      logger.info('文件列表演员头像预加载完成，无可查询演员')
      return Promise.resolve()
    }

    const requestKey = `${currentAvNumber}\u0000${actorNames.slice().sort().join('\u0000')}`
    if (completedGfriendsActorFaceLoadKey === requestKey) {
      logger.info('文件列表演员头像预加载完成，已命中当前结果', currentAvNumber)
      return Promise.resolve()
    }
    if (gfriendsActorFaceLoad && gfriendsActorFaceLoadKey === requestKey) {
      logger.info('文件列表演员头像预加载复用进行中请求', currentAvNumber)
      return gfriendsActorFaceLoad
    }

    /** 1.2 当前版本只接收同一影片和演员集合的结果。 */
    const loadVersion = dataVersion
    gfriendsActorFaceLoadKey = requestKey
    gfriendsActorFaceLoad = loadGfriendsActorFaces(actorNames)
      .then((actors) => {
        if (loadVersion !== dataVersion || gfriendsActorFaceLoadKey !== requestKey)
          return
        gfriendsActorFaces.value = actors
        const actorNames = new Set(actors.map(actor => normalizeActorName(actor.name)))
        missAVActorFaces.value = missAVActorFaces.value.filter(
          actor => !actorNames.has(normalizeActorName(actor.name)),
        )
        completedGfriendsActorFaceLoadKey = requestKey
      })
      .catch((error) => {
        logger.warn('文件列表演员头像预加载失败', currentAvNumber, error)
      })
      .finally(() => {
        if (gfriendsActorFaceLoadKey === requestKey)
          gfriendsActorFaceLoad = null
        logger.info('文件列表演员头像预加载完成', currentAvNumber, gfriendsActorFaces.value.length)
      })
    return gfriendsActorFaceLoad
  }

  const loadActorFaces = async (actorName: string): Promise<void> => {
    /*
     * ================================================================================
     * 步骤1：按需加载播放器演员头像
     * ================================================================================
     * 目标：gfriends 和影片资料站头像全部失败后，使用 MissAV 最终兜底。
     * 数据源：当前播放番号、可见资料标签演员名和 MissAV。
     * 操作：
     * 1) 等待 gfriends 查询完成并阻止已命中演员进入 MissAV
     * 2) 只查询当前失败演员并合并并发结果
     */
    logger.info('开始按需加载播放器演员头像', currentAvNumber, actorName)

    /** 1.1 当前失败节点没有演员或影片身份时不查询远程后备。 */
    const name = actorName.trim()
    if (!currentAvNumber || !name) {
      logger.info('播放器演员头像按需加载完成，无可查询演员')
      return
    }

    // 1.2 gfriends 有记录时不允许 MissAV 覆盖或替换该演员头像。
    await preloadGfriendsActorFaces()
    if (hasActorFace(name, gfriendsActorFaces.value)) {
      logger.info('播放器演员头像按需加载完成，gfriends 已命中', currentAvNumber, name)
      return
    }

    const avNumber = currentAvNumber
    const requestKey = `${avNumber}\u0000${normalizeActorName(name)}`
    if (completedMissAVActorFaceLoadKeys.has(requestKey)) {
      logger.info('播放器演员头像按需加载完成，已命中当前结果', avNumber, name)
      return
    }
    const activeLoad = missAVActorFaceLoads.get(requestKey)
    if (activeLoad) {
      logger.info('播放器演员头像按需加载复用进行中请求', currentAvNumber)
      return activeLoad
    }

    const loadVersion = dataVersion
    const load = missAV.getActorFacesByAvNumber(avNumber, [name])
      .then((actors) => {
        /** 1.3 文件已切换时不能把旧头像写回当前详情。 */
        if (loadVersion !== dataVersion || currentAvNumber !== avNumber)
          return
        const actorNames = new Set(actors.map(actor => normalizeActorName(actor.name)))
        missAVActorFaces.value = [
          ...missAVActorFaces.value.filter(actor => !actorNames.has(normalizeActorName(actor.name))),
          ...actors,
        ]
        completedMissAVActorFaceLoadKeys.add(requestKey)
      })
      .catch((error) => {
        logger.warn('播放器演员头像按需加载失败', avNumber, name, error)
      })
      .finally(() => {
        missAVActorFaceLoads.delete(requestKey)
        logger.info('播放器演员头像按需加载完成', avNumber, name, missAVActorFaces.value.length)
      })
    missAVActorFaceLoads.set(requestKey, load)
    return load
  }

  watch(sourceActorNames, () => {
    // 1.3 任一资料源补出演员名后，立即刷新 gfriends 主选头像。
    void preloadGfriendsActorFaces()
  })

  const clear = () => {
    /*
     * ================================================================================
     * 步骤1：清理播放器影片资料
     * ================================================================================
     * 目标：切换文件或关闭详情时不保留上一影片的任一来源状态。
     * 操作：
     * 1) 清空普通来源与专用来源状态
     * 2) 移除上一文件的专用来源标签
     */
    logger.info('开始清理播放器影片资料')

    // 1.1 先使进行中的头像请求失效，再清空所有来源状态。
    dataVersion += 1
    currentAvNumber = ''
    gfriendsActorFaces.value = []
    missAVActorFaces.value = []
    gfriendsActorFaceLoadKey = ''
    completedGfriendsActorFaceLoadKey = ''
    gfriendsActorFaceLoad = null
    missAVActorFaceLoads.clear()
    completedMissAVActorFaceLoadKeys.clear()
    javBusState.state.value = null
    javDBState.state.value = null
    javLibraryState.state.value = null
    specialState.state.value = null
    specialSourceName.value = null

    logger.info('播放器影片资料清理完成')
  }

  const load = (avNumber: string) => {
    /*
     * ================================================================================
     * 步骤1：按播放文件路由资料源
     * ================================================================================
     * 目标：普通番号保留三个播放器来源，FC2 增加专用来源。
     * 数据源：当前番号。
     * 操作：
     * 1) 清理上一文件状态
     * 2) FC2 加载 FD2PPV 和普通后备来源
     */
    logger.info('开始路由播放器影片资料', avNumber)

    // 1.1 文件切换后必须先移除旧标签和旧详情。
    clear()
    currentAvNumber = avNumber

    // 1.2 FC2 优先加载 FD2PPV，普通来源仍作为可手动切换的后备。
    if (isFd2PpvAvNumber(avNumber)) {
      specialSourceName.value = 'FD2PPV'
      specialState.execute(0, avNumber)
    }
    javDBState.execute(0, avNumber)
    javBusState.execute(0, avNumber)
    javLibraryState.execute(0, avNumber)

    logger.info('播放器影片资料路由完成', avNumber)
  }

  return {
    javBusState,
    javDBState,
    javLibraryState,
    specialState,
    specialSourceName,
    sourceTabs,
    gfriendsActorFaces,
    missAVActorFaces,
    clear,
    load,
    loadActorFaces,
  }
}
