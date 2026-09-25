/**
 * `is-twa-runtime.spec.ts` (DTJ-411, тест-план «Unit»).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isTwaRuntime } from './is-twa-runtime'

type WindowWithTelegram = typeof window & { Telegram?: { WebApp?: object } }

afterEach(() => {
  delete (window as WindowWithTelegram).Telegram
})

describe('isTwaRuntime', () => {
  it('возвращает false, когда window.Telegram отсутствует (обычный веб)', () => {
    expect(isTwaRuntime()).toBe(false)
  })

  it('возвращает false, когда window.Telegram присутствует, но WebApp — нет', () => {
    ;(window as WindowWithTelegram).Telegram = {}
    expect(isTwaRuntime()).toBe(false)
  })

  it('возвращает true, когда window.Telegram.WebApp присутствует (мок SDK)', () => {
    ;(window as WindowWithTelegram).Telegram = { WebApp: {} }
    expect(isTwaRuntime()).toBe(true)
  })

  it('не бросает исключение при отсутствии window (SSR-safe)', () => {
    expect(() => isTwaRuntime()).not.toThrow()
  })
})
