import { beforeEach, describe, expect, it } from 'vitest'
import { useCartSessionStore } from './cart-session-store'

/**
 * `cart-session-store.spec.ts` (DTJ-234). Тот же приём проверки `zustand/persist`, что
 * `shared/api/auth-store.spec.ts` — `localStorage` напрямую.
 */

const STORAGE_KEY = 'dorutj.cart-session'

interface PersistedCartSession {
  readonly state: { readonly sessionToken: string | null }
}

function readPersistedSessionToken(raw: string): string | null {
  return (JSON.parse(raw) as PersistedCartSession).state.sessionToken
}

describe('cart-session-store (DTJ-234)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useCartSessionStore.setState({ sessionToken: null })
  })

  it('1. начальное состояние — sessionToken null', () => {
    expect(useCartSessionStore.getState().sessionToken).toBeNull()
  })

  it('2. setToken кладёт значение в стор и персистирует в localStorage', () => {
    useCartSessionStore.getState().setToken('token-server-issued-1')
    expect(useCartSessionStore.getState().sessionToken).toBe('token-server-issued-1')
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(readPersistedSessionToken(raw ?? '{}')).toBe('token-server-issued-1')
  })

  it('3. setToken перезаписывает предыдущее значение безусловно (защита от session fixation)', () => {
    useCartSessionStore.getState().setToken('token-old')
    useCartSessionStore.getState().setToken('token-new')
    expect(useCartSessionStore.getState().sessionToken).toBe('token-new')
  })

  it('4. clear сбрасывает sessionToken в null', () => {
    useCartSessionStore.getState().setToken('token-server-issued-1')
    useCartSessionStore.getState().clear()
    expect(useCartSessionStore.getState().sessionToken).toBeNull()
  })
})
