import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACCESS_TOKEN_STORAGE_KEY,
  decodeRoleFromAccessToken,
  decodeTenantIdFromAccessToken,
  getCurrentRole,
  getCurrentTenantId,
} from './current-role'

function base64Url(json: unknown): string {
  const base64 = btoa(JSON.stringify(json))
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function buildJwt(payload: unknown): string {
  return `${base64Url({ alg: 'RS256' })}.${base64Url(payload)}.signature-not-verified-client-side`
}

describe('decodeRoleFromAccessToken', () => {
  it('возвращает null для null-токена (нет сессии)', () => {
    expect(decodeRoleFromAccessToken(null)).toBeNull()
  })

  it('возвращает null для пустой строки', () => {
    expect(decodeRoleFromAccessToken('')).toBeNull()
  })

  it('возвращает null для токена не из 3 частей', () => {
    expect(decodeRoleFromAccessToken('not-a-jwt')).toBeNull()
  })

  it('возвращает null, если payload — не валидный JSON (битый base64)', () => {
    expect(decodeRoleFromAccessToken('a.!!!not-base64!!!.c')).toBeNull()
  })

  it('возвращает роль для валидного токена super_admin', () => {
    const token = buildJwt({ sub: 'user-1', role: 'super_admin' })
    expect(decodeRoleFromAccessToken(token)).toBe('super_admin')
  })

  it('возвращает роль для валидного токена pharmacy_admin', () => {
    const token = buildJwt({ sub: 'user-2', role: 'pharmacy_admin' })
    expect(decodeRoleFromAccessToken(token)).toBe('pharmacy_admin')
  })

  it('возвращает null для нераспознанной строки роли', () => {
    const token = buildJwt({ sub: 'user-3', role: 'not_a_real_role' })
    expect(decodeRoleFromAccessToken(token)).toBeNull()
  })

  it('возвращает null, если role отсутствует в payload', () => {
    const token = buildJwt({ sub: 'user-4' })
    expect(decodeRoleFromAccessToken(token)).toBeNull()
  })

  it('возвращает null, если role — не строка', () => {
    const token = buildJwt({ sub: 'user-5', role: 42 })
    expect(decodeRoleFromAccessToken(token)).toBeNull()
  })
})

describe('getCurrentRole', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('возвращает null, если токен не сохранён', () => {
    expect(getCurrentRole()).toBeNull()
  })

  it('читает роль из localStorage под ACCESS_TOKEN_STORAGE_KEY', () => {
    const token = buildJwt({ sub: 'user-1', role: 'pharmacy_admin' })
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
    expect(getCurrentRole()).toBe('pharmacy_admin')
  })
})

// DTJ-381 — decode tenantId для funnel-page.tsx, та же логика/защита, что decodeRoleFromAccessToken.
describe('decodeTenantIdFromAccessToken', () => {
  it('возвращает null для null-токена', () => {
    expect(decodeTenantIdFromAccessToken(null)).toBeNull()
  })

  it('возвращает null, если tenantId отсутствует в payload', () => {
    const token = buildJwt({ sub: 'user-1', role: 'super_admin' })
    expect(decodeTenantIdFromAccessToken(token)).toBeNull()
  })

  it('возвращает null, если tenantId — не строка', () => {
    const token = buildJwt({ sub: 'user-1', role: 'super_admin', tenantId: 42 })
    expect(decodeTenantIdFromAccessToken(token)).toBeNull()
  })

  it('возвращает tenantId для валидного токена', () => {
    const token = buildJwt({ sub: 'user-1', role: 'super_admin', tenantId: 'tenant-42' })
    expect(decodeTenantIdFromAccessToken(token)).toBe('tenant-42')
  })
})

describe('getCurrentTenantId', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('возвращает null, если токен не сохранён', () => {
    expect(getCurrentTenantId()).toBeNull()
  })

  it('читает tenantId из localStorage под ACCESS_TOKEN_STORAGE_KEY', () => {
    const token = buildJwt({ sub: 'user-1', role: 'super_admin', tenantId: 'tenant-7' })
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
    expect(getCurrentTenantId()).toBe('tenant-7')
  })
})
