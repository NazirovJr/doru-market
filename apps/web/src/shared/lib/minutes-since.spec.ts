import { describe, expect, it } from 'vitest'
import { minutesSince } from './minutes-since'

describe('minutesSince', () => {
  it('считает полные минуты', () => {
    const now = Date.parse('2026-09-29T12:00:00Z')
    expect(minutesSince('2026-09-29T11:15:30Z', now)).toBe(44)
  })

  it('свежее минуты — минимум 1', () => {
    const now = Date.parse('2026-09-29T12:00:00Z')
    expect(minutesSince('2026-09-29T11:59:50Z', now)).toBe(1)
  })
})
