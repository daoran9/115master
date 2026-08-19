import type { Actor } from '@/utils/jav/jav'
import { describe, expect, it } from 'vitest'
import { hasActorFace, normalizeActorName } from '../actorFaces'

describe('播放器演员头像来源门禁', () => {
  it('统一姓名中的全半角和空格', () => {
    expect(normalizeActorName(' 藤田　ゆず ')).toBe(normalizeActorName('藤田 ゆず'))
  })

  it('只把同名且有地址的 gfriends 记录视为已命中', () => {
    const actors: Actor[] = [
      { name: '藤田ゆず', face: 'https://cdn.example/yuzu.jpg' },
      { name: 'イセドン内村' },
    ]

    expect(hasActorFace('藤田 ゆず', actors)).toBe(true)
    expect(hasActorFace('イセドン内村', actors)).toBe(false)
  })
})
