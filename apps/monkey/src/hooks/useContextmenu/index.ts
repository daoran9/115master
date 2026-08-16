import type { Ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { shallowRef } from 'vue'

export function useContextmenu(targetRef: Ref, callback?: (e: MouseEvent) => void) {
  const pos = shallowRef<{ x: number, y: number }>({ x: 0, y: 0 })
  const isContextmenu = shallowRef(false)

  useEventListener(targetRef, 'contextmenu', (e: MouseEvent) => {
    e.preventDefault()
    pos.value = {
      x: e.clientX,
      y: e.clientY,
    }
    isContextmenu.value = true
    callback?.(e)
  })

  return {
    pos,
    isContextmenu,
  }
}
