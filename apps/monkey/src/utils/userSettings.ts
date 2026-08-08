import type { ShallowRef } from 'vue'
import type { ThemeMode } from './theme'
import { GM_getValue, GM_setValue } from '$'
import { effectScope, shallowRef, watch } from 'vue'
import { appLogger } from './logger'

/** 用户设置接口 */
export interface Settings {
  /** 启动文件列表预览 */
  enableFilelistPreview: boolean
  /** 显示番号资料 */
  enableAvInfo: boolean
  /** 显示演员头像 */
  enableActressFaces: boolean
  /** 显示播放页影片详情 */
  enablePlayerMovieInfo: boolean
  /** 主题模式：跟随系统 / 浅色 / 深色 */
  theme: ThemeMode
}

export type UserSettingKey = keyof Settings

/** 默认设置 */
const DEFAULT_SETTINGS: Settings = {
  enableFilelistPreview: true,
  enableAvInfo: true,
  enableActressFaces: true,
  enablePlayerMovieInfo: true,
  theme: 'system',
}

/** 监听任务接口 */
interface WatchTask<K extends keyof Settings> {
  key: K
  callback: (oldValue: Settings[K], newValue: Settings[K]) => void
}

/** 任意监听任务 */
type AnyWatchTask = WatchTask<keyof Settings>

/**
 * 用户设置
 */
export class UserSettings {
  value: Settings
  private readonly logger = appLogger.sub('UserSettings')
  private watchTasks: AnyWatchTask[] = []
  constructor() {
    this.value = this.create()
  }

  /** 监听设置 */
  watch<K extends keyof Settings>(
    key: K,
    callback: (oldValue: Settings[K], newValue: Settings[K]) => void,
  ) {
    const watchTask = {
      key,
      callback,
    }
    this.watchTasks.push(watchTask as unknown as AnyWatchTask)

    /** 返回取消监听的函数 */
    return () => {
      const index = this.watchTasks.indexOf(watchTask as unknown as AnyWatchTask)
      if (index > -1) {
        this.watchTasks.splice(index, 1)
      }
    }
  }

  /** 创建用户设置 */
  private create() {
    const namespace = 'USER_SETTINGS'
    const value = GM_getValue(namespace) ?? {}
    const userSettings = { ...DEFAULT_SETTINGS, ...value }
    const proxy = new Proxy(userSettings, {
      get: (target, key) => {
        return target[key]
      },
      set: (target, key, newValue) => {
        /**
         * ================================================================================
         * 步骤1：持久化用户设置
         * ================================================================================
         * 目标：同步内存、GM 存储和运行时监听者。
         * 操作：
         * 1) 保存新值到 USER_SETTINGS
         * 2) 通知同一设置的监听者
         */
        this.logger.info('开始更新用户设置', String(key))

        const oldValue = target[key]
        target[key] = newValue
        GM_setValue(namespace, target)
        // 触发相关的watch回调
        this.watchTasks.forEach((task) => {
          if (task.key === key) {
            (task.callback as (oldValue: unknown, newValue: unknown) => void)(oldValue, newValue)
          }
        })

        this.logger.info('用户设置更新完成', String(key))
        return true
      },
    })
    return proxy
  }
}

/** 用户设置实例 */
export const userSettings = new UserSettings()

/** 每个设置键只保留一份 Vue 响应式状态。 */
const userSettingRefs = new Map<UserSettingKey, unknown>()

/** 共享监听使用独立作用域，不随首次调用它的组件卸载。 */
const userSettingScope = effectScope(true)

/**
 * 在 Vue 组件中双向绑定一项 GM 用户设置。
 */
export function useUserSetting<K extends UserSettingKey>(key: K): ShallowRef<Settings[K]> {
  const cachedState = userSettingRefs.get(key) as ShallowRef<Settings[K]> | undefined
  if (cachedState)
    return cachedState

  const logger = appLogger.sub('useUserSetting')

  /**
   * ================================================================================
   * 步骤1：建立共享设置状态
   * ================================================================================
   * 目标：同一设置键在脚本生命周期内只注册一次双向监听。
   * 操作：
   * 1) 创建按键缓存的 shallowRef
   * 2) 在独立作用域绑定用户设置与 Vue 状态
   */
  logger.info('开始创建共享用户设置状态', key)

  /** 1.1 创建当前设置键的唯一响应式状态 */
  const state = shallowRef(userSettings.value[key]) as unknown as ShallowRef<Settings[K]>

  // 1.2 在脚本级独立作用域建立双向监听
  userSettingScope.run(() => {
    userSettings.watch(key, (_, value) => {
      state.value = value
    })

    watch(state, (value) => {
      if (userSettings.value[key] !== value)
        userSettings.value[key] = value
    }, { flush: 'sync' })
  })

  // 1.3 缓存共享状态，供后续组件复用
  userSettingRefs.set(key, state)

  logger.info('共享用户设置状态创建完成', key)
  return state
}
