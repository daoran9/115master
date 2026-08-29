// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficialScrollHistory } from '../scrollHistory'

const STORAGE_KEY = '115_master_official_scroll_history'

afterEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('officialScrollHistory', () => {
  it('只保留最近 128 个滚动位置', () => {
    /*
     * ================================================================================
     * 步骤1：连续切换新版目录
     * ================================================================================
     * 目标：证明滚动记录不会随浏览目录数量无限增长。
     * 数据源：131 个独立目录键和对应滚动容器。
     * 操作：
     * 1) 依次绑定并保存每个目录位置
     * 2) 核对最旧记录被淘汰且最新记录保留
     */
    console.info('[unit] 开始验证新版滚动记录上限')

    /** 1.1 同步回调执行恢复逻辑，避免测试环境遗留动画帧任务。 */
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const history = new OfficialScrollHistory()
    for (let index = 0; index < 131; index += 1) {
      const element = document.createElement('div')
      element.scrollTop = index
      history.sync(element, `directory-${index}`)
    }
    history.destroy()

    /** 1.2 销毁时保存最后一个目标，131 条记录最终只保留最近 128 条。 */
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, number>
    expect(Object.keys(saved)).toHaveLength(128)
    expect(saved['directory-0']).toBeUndefined()
    expect(saved['directory-1']).toBeUndefined()
    expect(saved['directory-2']).toBeUndefined()
    expect(saved['directory-3']).toBe(3)
    expect(saved['directory-130']).toBe(130)

    console.info('[unit] 新版滚动记录上限验证完成')
  })
})
