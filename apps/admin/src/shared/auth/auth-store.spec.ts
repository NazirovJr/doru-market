import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACCESS_TOKEN_STORAGE_KEY } from './current-role'
import { useAuthStore, type AuthUser } from './auth-store'

const USER: AuthUser = { id: 'u1', role: 'super_admin', tenantId: null, phoneNumber: null, fullName: 'Admin' }

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

afterEach(() => {
  localStorage.clear()
})

describe('useAuthStore', () => {
  it('setSession зеркалирует accessToken в ACCESS_TOKEN_STORAGE_KEY (контракт current-role.ts)', () => {
    useAuthStore.getState().setSession({ accessToken: 'tok', refreshToken: 'ref', user: USER })

    expect(useAuthStore.getState().accessToken).toBe('tok')
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('tok')
  })

  it('setAccessToken обновляет и стор, и зеркало в localStorage', () => {
    useAuthStore.getState().setAccessToken('new-tok')

    expect(useAuthStore.getState().accessToken).toBe('new-tok')
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('new-tok')
  })

  it('clear очищает стор и убирает accessToken из localStorage', () => {
    useAuthStore.getState().setSession({ accessToken: 'tok', refreshToken: 'ref', user: USER })
    useAuthStore.getState().clear()

    expect(useAuthStore.getState()).toMatchObject({ accessToken: null, refreshToken: null, user: null })
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('setState (тестовый хелпер) подменяет data-срез напрямую', () => {
    useAuthStore.setState({ accessToken: 'direct', user: USER })

    expect(useAuthStore.getState().accessToken).toBe('direct')
    expect(useAuthStore.getState().user).toEqual(USER)
  })
})
