import { describe, expect, it, beforeEach } from 'vitest'
import { useAuthStore } from './auth-store'

/**
 * Тест для `auth-store` (EP-01, DTJ-028).
 *
 * Покрывает (тикет DTJ-028 «Тест-план»):
 *   - `setSession` кладёт access+refresh+user в стор.
 *   - `clear` очищает все поля.
 *   - `refreshToken` (но НЕ `accessToken`) персистируется в `localStorage`
 *     (компромисс XSS-риска, задокументирован в JSDoc стора).
 *
 * `zustand/persist` использует async-storage-helper; наш `setItem/getItem` —
 * глобальный `window.localStorage` (jsdom). Проверяется содержимое
 * `localStorage` напрямую.
 */

const STORAGE_KEY = 'dorutj.auth'

const TEST_USER = {
  id: 'user-1',
  role: 'customer' as const,
  tenantId: 'neutral',
  phoneNumber: '+992917123456',
  fullName: 'Test',
}

describe('auth-store (DTJ-028)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
  })

  it('1. начальное состояние: всё null', () => {
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.user).toBeNull()
  })

  it('2. setSession кладёт access+refresh+user', () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: TEST_USER,
    })
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('access-1')
    expect(s.refreshToken).toBe('refresh-1')
    expect(s.user).toEqual(TEST_USER)
  })

  it('3. clear очищает все поля (включая persisted refresh)', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: TEST_USER,
    })
    // zustand/persist пишет асинхронно — ждём один микротаск.
    await new Promise((resolve) => setTimeout(resolve, 0))
    useAuthStore.getState().clear()
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.user).toBeNull()
    // localStorage либо очищен, либо refresh-токен сброшен.
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { state?: { refreshToken?: string | null } }
      expect(parsed.state?.refreshToken ?? null).toBeNull()
    }
  })

  it('4. setAccessToken обновляет только accessToken (refresh и user не трогает)', () => {
    useAuthStore.getState().setSession({
      accessToken: 'old',
      refreshToken: 'refresh-1',
      user: TEST_USER,
    })
    useAuthStore.getState().setAccessToken('new')
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('new')
    expect(s.refreshToken).toBe('refresh-1')
    expect(s.user).toEqual(TEST_USER)
  })

  it('5. refreshToken персистируется в localStorage, accessToken — НЕТ', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      user: TEST_USER,
    })
    // zustand/persist асинхронен — даём один микротаск.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as {
      state: { refreshToken: string | null; user: typeof TEST_USER | null }
    }
    // refreshToken и user записаны
    expect(parsed.state.refreshToken).toBe('refresh-secret')
    expect(parsed.state.user).toEqual(TEST_USER)
    // accessToken НЕ персистируется (XSS-компромисс)
    expect('accessToken' in parsed.state).toBe(false)
  })
})
