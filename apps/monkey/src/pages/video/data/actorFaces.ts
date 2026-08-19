import type { Actor } from '@/utils/jav/jav'

/** 统一演员姓名，避免来源间空格和全半角差异。 */
export function normalizeActorName(name: string) {
  return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/** 判断指定演员是否已有可用头像。 */
export function hasActorFace(name: string, actors: Actor[]) {
  const key = normalizeActorName(name)
  return actors.some(actor => Boolean(actor.face) && normalizeActorName(actor.name) === key)
}
