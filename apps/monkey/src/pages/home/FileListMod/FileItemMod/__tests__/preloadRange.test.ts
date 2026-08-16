import { describe, expect, it, vi } from 'vitest'
import { appLogger } from '@/utils/logger'
import { watchFileItemPreloadRange } from '../preloadRange'

const logger = appLogger.sub('FileItemPreloadRangeTest')

describe('watchFileItemPreloadRange', () => {
  it('mounts immediately after a large background scroll jump', () => {
    /*
     * ================================================================================
     * 步骤1：模拟后台大跨度滚动
     * ================================================================================
     * 目标：动画帧和定时器都未运行时，目标详情仍在 scroll 回调内挂载。
     * 数据源：变化超过阈值的 scrollTop 和已进入范围的容器。
     * 操作：
     * 1) 注册一个视口外详情
     * 2) 跳转滚动位置并立即核对挂载
     */
    logger.info('开始验证后台大跨度滚动预加载')

    const ownerWindow = {
      innerHeight: 800,
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    } as unknown as Window
    let scrollTop = 0
    let scrollListener: EventListener | undefined
    const scrollBox = {
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        scrollListener = listener
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
      get scrollTop() {
        return scrollTop
      },
    } as unknown as Element
    let top = 2000
    const container = {
      isConnected: true,
      ownerDocument: { defaultView: ownerWindow },
      getBoundingClientRect: () => ({ top, bottom: top + 96 }),
    } as unknown as HTMLElement
    const onEnter = vi.fn()

    /** 1.1 目标进入范围后大幅跳转滚动位置。 */
    const stop = watchFileItemPreloadRange(container, scrollBox, onEnter)
    scrollTop = 4500
    top = 650
    scrollListener?.(new Event('scroll'))

    /** 1.2 不推进动画帧或定时器，挂载必须已完成。 */
    expect(onEnter).toHaveBeenCalledOnce()
    expect(ownerWindow.requestAnimationFrame).not.toHaveBeenCalled()
    stop()
    logger.info('后台大跨度滚动预加载验证完成')
  })

  it('shares one scroll listener and mounts each visible item once', () => {
    /*
     * ================================================================================
     * 步骤1：模拟后台标签滚动
     * ================================================================================
     * 目标：验证 IntersectionObserver 不回调时，共享滚动兜底仍能挂载详情。
     * 数据源：两个待加载容器、一个滚动容器和可控动画帧队列。
     * 操作：
     * 1) 注册两个视口外详情
     * 2) 把详情移入范围并触发滚动
     */
    logger.info('开始验证共享滚动预加载兜底')

    const frames: FrameRequestCallback[] = []
    const ownerWindow = {
      innerHeight: 800,
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
      cancelAnimationFrame: vi.fn(),
    } as unknown as Window
    const scrollListeners: EventListener[] = []
    const scrollBox = {
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        scrollListeners.push(listener)
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
    } as unknown as Element
    let firstTop = 2000
    let secondTop = 2400
    const createContainer = (readTop: () => number) => ({
      isConnected: true,
      ownerDocument: { defaultView: ownerWindow },
      getBoundingClientRect: () => ({
        top: readTop(),
        bottom: readTop() + 96,
      }),
    }) as unknown as HTMLElement
    const firstEnter = vi.fn()
    const secondEnter = vi.fn()

    /** 1.1 两个详情共用同一个滚动监听器。 */
    const stopFirst = watchFileItemPreloadRange(
      createContainer(() => firstTop),
      scrollBox,
      firstEnter,
    )
    const stopSecond = watchFileItemPreloadRange(
      createContainer(() => secondTop),
      scrollBox,
      secondEnter,
    )
    expect(scrollBox.addEventListener).toHaveBeenCalledOnce()

    /** 1.2 第一项进入范围后只触发第一项，第二项继续等待。 */
    firstTop = 650
    scrollListeners[0]?.(new Event('scroll'))
    frames.shift()?.(0)
    expect(firstEnter).toHaveBeenCalledOnce()
    expect(secondEnter).not.toHaveBeenCalled()

    /** 1.3 第二项进入范围后完成挂载，并由最后一个 disposer 解绑监听器。 */
    secondTop = 650
    scrollListeners[0]?.(new Event('scroll'))
    frames.shift()?.(1)
    expect(secondEnter).toHaveBeenCalledOnce()
    stopFirst()
    stopSecond()
    expect(scrollBox.removeEventListener).toHaveBeenCalledOnce()

    logger.info('共享滚动预加载兜底验证完成')
  })

  it('mounts visible items when background tabs pause animation frames', async () => {
    /*
     * ================================================================================
     * 步骤1：模拟后台动画帧暂停
     * ================================================================================
     * 目标：标签页退到后台后，滚动仍能挂载进入范围的详情。
     * 数据源：不回调的 requestAnimationFrame 和可推进的定时器。
     * 操作：
     * 1) 注册一个视口外详情并触发滚动
     * 2) 只推进定时器并核对详情挂载
     */
    logger.info('开始验证后台滚动定时器兜底')
    vi.useFakeTimers()

    const ownerWindow = {
      innerHeight: 800,
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    } as unknown as Window
    let scrollListener: EventListener | undefined
    const scrollBox = {
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        scrollListener = listener
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
    } as unknown as Element
    let top = 2000
    const container = {
      isConnected: true,
      ownerDocument: { defaultView: ownerWindow },
      getBoundingClientRect: () => ({ top, bottom: top + 96 }),
    } as unknown as HTMLElement
    const onEnter = vi.fn()

    /** 1.1 详情进入范围后触发滚动，但不执行动画帧回调。 */
    const stop = watchFileItemPreloadRange(container, scrollBox, onEnter)
    top = 650
    scrollListener?.(new Event('scroll'))
    expect(onEnter).not.toHaveBeenCalled()

    /** 1.2 定时器到期后挂载详情，并取消仍未执行的动画帧。 */
    await vi.advanceTimersByTimeAsync(120)
    expect(onEnter).toHaveBeenCalledOnce()
    expect(ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(1)
    stop()
    vi.useRealTimers()
    logger.info('后台滚动定时器兜底验证完成')
  })

  it('polls changed scroll positions when browsers omit scroll events', async () => {
    /*
     * ================================================================================
     * 步骤1：模拟后台滚动事件缺失
     * ================================================================================
     * 目标：滚动容器位置变化但未派发 scroll 时，详情仍能自动挂载。
     * 数据源：变化的 scrollTop、未触发的滚动监听器和可推进的后台轮询。
     * 操作：
     * 1) 注册一个视口外详情并只改变坐标
     * 2) 推进后台轮询并核对详情挂载
     */
    logger.info('开始验证后台滚动事件缺失兜底')
    vi.useFakeTimers()

    const ownerWindow = {
      innerHeight: 800,
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    } as unknown as Window
    let scrollTop = 0
    const scrollBox = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
      get scrollTop() {
        return scrollTop
      },
    } as unknown as Element
    let top = 2000
    const container = {
      isConnected: true,
      ownerDocument: { defaultView: ownerWindow },
      getBoundingClientRect: () => ({ top, bottom: top + 96 }),
    } as unknown as HTMLElement
    const onEnter = vi.fn()

    /** 1.1 只改变详情坐标，不调用注册的滚动监听器。 */
    const stop = watchFileItemPreloadRange(container, scrollBox, onEnter)
    scrollTop = 1100
    top = 650
    expect(onEnter).not.toHaveBeenCalled()

    /** 1.2 后台轮询到期后挂载详情。 */
    await vi.advanceTimersByTimeAsync(1000)
    expect(onEnter).toHaveBeenCalledOnce()
    stop()
    vi.useRealTimers()
    logger.info('后台滚动事件缺失兜底验证完成')
  })

  it('polls changed item geometry when the native list keeps the same scrollTop', async () => {
    /*
     * ================================================================================
     * 步骤1：模拟原生列表无滚动重排
     * ================================================================================
     * 目标：目录切换或列表恢复只改变节点坐标时，详情仍能自动挂载。
     * 数据源：固定 scrollTop、变化的详情坐标和可推进的后台轮询。
     * 操作：
     * 1) 注册一个视口外详情并保持 scrollTop 不变
     * 2) 只改变节点坐标后推进轮询
     */
    logger.info('开始验证原生列表无滚动重排兜底')
    vi.useFakeTimers()

    const ownerWindow = {
      innerHeight: 800,
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    } as unknown as Window
    const scrollBox = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
      scrollTop: 0,
    } as unknown as Element
    let top = 2000
    const container = {
      isConnected: true,
      ownerDocument: { defaultView: ownerWindow },
      getBoundingClientRect: () => ({ top, bottom: top + 96 }),
    } as unknown as HTMLElement
    const onEnter = vi.fn()

    /** 1.1 节点进入范围，但不改变 scrollTop 也不派发滚动事件。 */
    const stop = watchFileItemPreloadRange(container, scrollBox, onEnter)
    top = 650
    expect(onEnter).not.toHaveBeenCalled()

    /** 1.2 后台轮询按几何位置识别并挂载详情。 */
    await vi.advanceTimersByTimeAsync(1000)
    expect(onEnter).toHaveBeenCalledOnce()
    stop()
    vi.useRealTimers()
    logger.info('原生列表无滚动重排兜底验证完成')
  })
})
