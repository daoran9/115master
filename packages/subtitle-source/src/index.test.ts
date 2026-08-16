import { describe, expect, it } from 'vitest'
import * as subtitle from './index.ts'

describe('subtitle package exports', () => {
  it('exports subtitleSource namespace', () => {
    expect(subtitle.subtitleSource).toBeDefined()
    expect(subtitle.subtitleSource.Thunder).toBeDefined()
    expect(subtitle.subtitleSource.SubtitleCat).toBeDefined()
    expect(subtitle.subtitleSource.AvSubtitles).toBeDefined()
    expect(subtitle.subtitleSource.Aiyi).toBeDefined()
  })
})
