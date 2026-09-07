import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useReducedMotion } from './use-reduced-motion'

type Listener = (event: MediaQueryListEvent) => void

function installMatchMedia(initialMatches: boolean): { setMatches: (matches: boolean) => void } {
  let matches = initialMatches
  const listeners = new Set<Listener>()

  const mediaQueryList: MediaQueryList = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener as Listener)
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener as Listener)
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as MediaQueryList

  Object.defineProperty(mediaQueryList, 'matches', {
    get: () => matches,
  })

  window.matchMedia = () => mediaQueryList

  return {
    setMatches: (next: boolean) => {
      matches = next
      const event = { matches: next } as MediaQueryListEvent
      listeners.forEach((listener) => {
        listener(event)
      })
    },
  }
}

afterEach(() => {
  // @ts-expect-error -- тестовый мок matchMedia намеренно удаляется между тестами (15 симв.)
  delete window.matchMedia
})

describe('useReducedMotion', () => {
  it('returns false and does not throw when matchMedia is unsupported', () => {
    const { result } = renderHook(() => useReducedMotion())

    expect(result.current).toBe(false)
  })

  it('returns current matchMedia state on mount', () => {
    installMatchMedia(true)

    const { result } = renderHook(() => useReducedMotion())

    expect(result.current).toBe(true)
  })

  it('reacts to runtime preference change via change event', () => {
    const { setMatches } = installMatchMedia(false)

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => {
      setMatches(true)
    })

    expect(result.current).toBe(true)
  })
})
