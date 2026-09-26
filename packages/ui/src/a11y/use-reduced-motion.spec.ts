/**
 * `use-reduced-motion.spec.ts` (DTJ-403, тест-план тикета).
 *
 * `jsdom` не реализует `window.matchMedia` — каждый тест ставит собственный минимальный
 * `MediaQueryList`-дублёр с ручным управлением `matches` и подпиской на `change`, чтобы
 * детерминированно симулировать переключение системной настройки в рантайме.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { REDUCED_MOTION_QUERY, useReducedMotion } from './use-reduced-motion'

type ChangeListener = (event: Pick<MediaQueryListEvent, 'matches'>) => void

class FakeMediaQueryList {
  matches: boolean
  readonly media: string
  private readonly listeners = new Set<ChangeListener>()

  constructor(media: string, matches: boolean) {
    this.media = media
    this.matches = matches
  }

  addEventListener(type: string, listener: ChangeListener): void {
    if (type === 'change') {
      this.listeners.add(listener)
    }
  }

  removeEventListener(type: string, listener: ChangeListener): void {
    if (type === 'change') {
      this.listeners.delete(listener)
    }
  }

  /** Симулирует переключение системной настройки пользователем без перезагрузки страницы. */
  emitChange(matches: boolean): void {
    this.matches = matches
    for (const listener of this.listeners) {
      listener({ matches })
    }
  }
}

const installMatchMedia = (initialMatches: boolean): FakeMediaQueryList => {
  const fake = new FakeMediaQueryList(REDUCED_MOTION_QUERY, initialMatches)
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      expect(query).toBe(REDUCED_MOTION_QUERY)
      return fake
    }),
  )
  return fake
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useReducedMotion', () => {
  it('returns current matchMedia state on mount', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('returns false on mount when the preference is not set', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it('reacts to runtime preference change via change event without remounting', () => {
    const fake = installMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => {
      fake.emitChange(true)
    })
    expect(result.current).toBe(true)

    act(() => {
      fake.emitChange(false)
    })
    expect(result.current).toBe(false)
  })

  it('treats an environment without matchMedia as "preference not set"', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it('unsubscribes from the media query on unmount', () => {
    const fake = installMatchMedia(false)
    const removeSpy = vi.spyOn(fake, 'removeEventListener')
    const { unmount } = renderHook(() => useReducedMotion())
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
