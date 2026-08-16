import { appLogger } from '@/utils/logger'

const logger = appLogger.sub('FileItemPreloadRange')
export const FILE_ITEM_PRELOAD_MARGIN = 600
const BACKGROUND_PRELOAD_POLL_INTERVAL = 1000
const IMMEDIATE_PRELOAD_SCROLL_DISTANCE = 120

interface PendingPreloadItem {
  container: HTMLElement
  onEnter: () => void
}

interface PreloadScrollGroup {
  backgroundTimerId: ReturnType<typeof globalThis.setTimeout> | null
  frameId: number | null
  fallbackTimerId: ReturnType<typeof globalThis.setTimeout> | null
  items: Set<PendingPreloadItem>
  lastObservedScrollTop: number
  listener: () => void
  ownerWindow: Window
}

const preloadScrollGroups = new WeakMap<Element, PreloadScrollGroup>()

/** 挂载已经进入预加载范围的待处理项。 */
function mountPendingPreloadItems(
  scrollBox: Element,
  group: PreloadScrollGroup,
) {
  for (const pendingItem of [...group.items]) {
    if (!pendingItem.container.isConnected) {
      group.items.delete(pendingItem)
      continue
    }
    if (!isWithinFileItemPreloadRange(pendingItem.container, scrollBox))
      continue
    group.items.delete(pendingItem)
    pendingItem.onEnter()
  }
}

/** 判断插件附加区是否已经进入列表视口附近。 */
export function isWithinFileItemPreloadRange(
  container: HTMLElement,
  scrollBox: Element,
) {
  /*
   * ================================================================================
   * 步骤1：按几何位置判断首屏预加载范围
   * ================================================================================
   * 目标：后台标签不触发 IntersectionObserver 时仍加载首屏详情和预览。
   * 数据源：插件附加区、列表滚动容器和当前视口矩形。
   * 操作：
   * 1) 优先读取有效滚动容器矩形
   * 2) 零尺寸容器回退浏览器视口并扩展 600px
   */
  logger.info('开始判断文件增强预加载范围')
  const ownerWindow = container.ownerDocument.defaultView
  if (!ownerWindow) {
    logger.info('文件增强预加载范围判断完成，无页面窗口')
    return false
  }

  const containerRect = container.getBoundingClientRect()
  const measuredRootRect = scrollBox === container.ownerDocument.body
    || scrollBox === container.ownerDocument.documentElement
    ? { top: 0, bottom: ownerWindow.innerHeight }
    : scrollBox.getBoundingClientRect()
  const rootRect = measuredRootRect.bottom > measuredRootRect.top
    ? measuredRootRect
    : { top: 0, bottom: ownerWindow.innerHeight }
  const result = containerRect.bottom >= rootRect.top - FILE_ITEM_PRELOAD_MARGIN
    && containerRect.top <= rootRect.bottom + FILE_ITEM_PRELOAD_MARGIN

  logger.info('文件增强预加载范围判断完成', result)
  return result
}

/**
 * 注册滚动位置兜底。
 *
 * 后台标签中的 IntersectionObserver 可能被浏览器暂停；每个滚动容器只绑定一个
 * scroll 监听器，并在下一帧统一检查尚未挂载的详情。
 */
export function watchFileItemPreloadRange(
  container: HTMLElement,
  scrollBox: Element,
  onEnter: () => void,
): () => void {
  /*
   * ================================================================================
   * 步骤2：注册共享滚动预加载兜底
   * ================================================================================
   * 目标：IntersectionObserver 被后台节流时，滚入视口的详情仍能开始加载。
   * 数据源：当前详情容器、旧版列表滚动容器和滚动事件。
   * 操作：
   * 1) 每个滚动容器只绑定一个监听器
   * 2) 每帧批量检查待加载项，命中后立即移出集合
   */
  logger.info('开始注册文件增强滚动预加载兜底')

  const ownerWindow = container.ownerDocument.defaultView
  if (!ownerWindow) {
    logger.info('文件增强滚动预加载兜底注册完成，无页面窗口')
    return () => {}
  }

  const item: PendingPreloadItem = { container, onEnter }
  let group = preloadScrollGroups.get(scrollBox)
  if (!group) {
    const items = new Set<PendingPreloadItem>()
    const pollInBackground = () => {
      const activeGroup = preloadScrollGroups.get(scrollBox)
      if (!activeGroup)
        return

      activeGroup.backgroundTimerId = null
      // 2.1 目录切换和原生列表重排可能只改变节点坐标，不改变 scrollTop。
      activeGroup.lastObservedScrollTop = scrollBox.scrollTop
      mountPendingPreloadItems(scrollBox, activeGroup)
      if (
        preloadScrollGroups.get(scrollBox) === activeGroup
        && activeGroup.items.size > 0
      ) {
        activeGroup.backgroundTimerId = globalThis.setTimeout(
          pollInBackground,
          BACKGROUND_PRELOAD_POLL_INTERVAL,
        )
      }
    }
    group = {
      backgroundTimerId: null,
      frameId: null,
      fallbackTimerId: null,
      items,
      lastObservedScrollTop: scrollBox.scrollTop,
      ownerWindow,
      listener: () => {
        const activeGroup = preloadScrollGroups.get(scrollBox)
        if (!activeGroup) {
          return
        }

        /*
         * ================================================================================
         * 步骤3：同步检查大跨度滚动
         * ================================================================================
         * 目标：后台标签同时节流动画帧和定时器时，仍能立即挂载新视口详情。
         * 数据源：共享滚动容器的上次和当前 scrollTop。
         * 操作：
         * 1) 大跨度滚动同步检查几何范围
         * 2) 小跨度滚动仍由原有批处理合并
         */
        logger.info('开始检查大跨度滚动预加载')
        const currentScrollTop = scrollBox.scrollTop
        const scrollDistance = Math.abs(
          currentScrollTop - activeGroup.lastObservedScrollTop,
        )
        if (
          Number.isFinite(scrollDistance)
          && scrollDistance >= IMMEDIATE_PRELOAD_SCROLL_DISTANCE
        ) {
          activeGroup.lastObservedScrollTop = currentScrollTop
          mountPendingPreloadItems(scrollBox, activeGroup)
        }
        logger.info('大跨度滚动预加载检查完成', scrollDistance)

        /** 3.1 同步挂载可能由最后一个 disposer 删除共享组。 */
        if (
          preloadScrollGroups.get(scrollBox) !== activeGroup
          || activeGroup.items.size === 0
          || activeGroup.frameId !== null
          || activeGroup.fallbackTimerId !== null
        ) {
          return
        }

        // eslint-disable-next-line jsdoc/convert-to-jsdoc-comments -- 项目步骤注释使用编号行注释。
        // 3.2 前台优先在下一动画帧批量检查；后台暂停动画帧时由定时器接管。
        const flush = () => {
          const currentGroup = preloadScrollGroups.get(scrollBox)
          if (!currentGroup)
            return

          if (currentGroup.frameId !== null)
            currentGroup.ownerWindow.cancelAnimationFrame(currentGroup.frameId)
          if (currentGroup.fallbackTimerId !== null)
            globalThis.clearTimeout(currentGroup.fallbackTimerId)
          currentGroup.frameId = null
          currentGroup.fallbackTimerId = null
          currentGroup.lastObservedScrollTop = scrollBox.scrollTop
          mountPendingPreloadItems(scrollBox, currentGroup)
        }
        activeGroup.frameId = activeGroup.ownerWindow.requestAnimationFrame(flush)
        activeGroup.fallbackTimerId = globalThis.setTimeout(flush, 120)
      },
    }
    preloadScrollGroups.set(scrollBox, group)
    scrollBox.addEventListener('scroll', group.listener, { passive: true })
    group.backgroundTimerId = globalThis.setTimeout(
      pollInBackground,
      BACKGROUND_PRELOAD_POLL_INTERVAL,
    )
  }

  // 2.2 保存当前待加载项；销毁时只移除自身，最后一项负责解绑共享监听器。
  group.items.add(item)
  logger.info('文件增强滚动预加载兜底注册完成')

  return () => {
    const activeGroup = preloadScrollGroups.get(scrollBox)
    if (!activeGroup)
      return
    activeGroup.items.delete(item)
    if (activeGroup.items.size > 0)
      return
    scrollBox.removeEventListener('scroll', activeGroup.listener)
    if (activeGroup.frameId !== null)
      activeGroup.ownerWindow.cancelAnimationFrame(activeGroup.frameId)
    if (activeGroup.fallbackTimerId !== null)
      globalThis.clearTimeout(activeGroup.fallbackTimerId)
    if (activeGroup.backgroundTimerId !== null)
      globalThis.clearTimeout(activeGroup.backgroundTimerId)
    preloadScrollGroups.delete(scrollBox)
  }
}
