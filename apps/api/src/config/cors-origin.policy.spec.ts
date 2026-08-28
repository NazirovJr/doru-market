import { describe, expect, it } from 'vitest'
import { isAllowedCorsOrigin, type CorsOriginPolicyConfig } from '@/config/cors-origin.policy'

function fakeConfig(overrides: Partial<CorsOriginPolicyConfig> = {}): CorsOriginPolicyConfig {
  return {
    isDevelopment: overrides.isDevelopment ?? false,
    corsStaticOrigins: overrides.corsStaticOrigins ?? ['https://dorutj.com'],
  }
}

describe('isAllowedCorsOrigin', () => {
  it('разрешает origin из статического списка', () => {
    expect(isAllowedCorsOrigin('https://dorutj.com', fakeConfig())).toBe(true)
  })

  it('запрещает origin вне списка в production', () => {
    expect(isAllowedCorsOrigin('https://evil.example.com', fakeConfig({ isDevelopment: false }))).toBe(false)
  })

  it('разрешает http://localhost:* только в development', () => {
    expect(isAllowedCorsOrigin('http://localhost:5173', fakeConfig({ isDevelopment: true }))).toBe(true)
    expect(isAllowedCorsOrigin('http://localhost:5173', fakeConfig({ isDevelopment: false }))).toBe(false)
  })

  it('не разрешает произвольный поддомен localhost без порта', () => {
    expect(isAllowedCorsOrigin('http://localhost', fakeConfig({ isDevelopment: true }))).toBe(false)
  })
})
