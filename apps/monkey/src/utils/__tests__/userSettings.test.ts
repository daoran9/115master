import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const gmStore = vi.hoisted(() => new Map<string, unknown>())
const gmSetValue = vi.hoisted(() => vi.fn((key: string, value: unknown) => {
  gmStore.set(key, structuredClone(value))
}))
const testLogger = { info: vi.fn() }

vi.mock('$', () => ({
  GM_getValue: (key: string) => gmStore.get(key),
  GM_setValue: gmSetValue,
}))

vi.mock('@/utils/logger', () => ({
  appLogger: {
    sub: () => ({ info: vi.fn() }),
  },
}))

const { userSettings, useUserSetting } = await import('../userSettings')

describe('useUserSetting', () => {
  beforeEach(() => {
    gmSetValue.mockClear()
  })

  it('同一设置键复用一份状态和一组监听', () => {
    /**
     * ================================================================================
     * 步骤1：验证设置状态按键共享
     * ================================================================================
     * 目标：文件列表中的重复组件不会重复注册设置监听。
     * 操作：
     * 1) 连续获取同一设置键
     * 2) 验证引用复用和双向同步
     */
    testLogger.info('开始验证共享用户设置状态')

    /** 1.1 监听底层设置注册次数 */
    const watchSpy = vi.spyOn(userSettings, 'watch')

    /** 1.2 在临时组件作用域内首次获取设置键 */
    const ownerScope = effectScope()
    const first = ownerScope.run(() => useUserSetting('enableAvInfo'))!

    // 1.3 模拟首次调用设置的组件卸载
    ownerScope.stop()

    /** 1.4 再次获取同一设置键 */
    const second = useUserSetting('enableAvInfo')

    // 1.5 验证引用复用且只注册一次底层监听
    expect(second).toBe(first)
    expect(watchSpy).toHaveBeenCalledOnce()

    // 1.6 验证首次组件卸载后仍能写回用户设置
    first.value = false
    expect(userSettings.value.enableAvInfo).toBe(false)
    expect(gmSetValue).toHaveBeenCalledOnce()

    // 1.7 验证用户设置变化同步到共享状态
    userSettings.value.enableAvInfo = true
    expect(second.value).toBe(true)

    testLogger.info('共享用户设置状态验证完成')
  })
})
