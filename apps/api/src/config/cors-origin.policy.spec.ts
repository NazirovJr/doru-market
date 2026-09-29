import { describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { buildCorsOptions, isAllowedCorsOrigin, type CorsOriginPolicyConfig } from '@/config/cors-origin.policy'

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

describe('buildCorsOptions — ответы @fastify/cors для браузерного клиента на другом origin', () => {
  const ORIGIN = 'https://dorutj.com'

  async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify()
    await app.register(cors, buildCorsOptions(fakeConfig()))
    app.get('/ping', () => ({ ok: true }))
    return app
  }

  it('preflight разрешает PUT, PATCH и DELETE', async () => {
    const app = await buildApp()
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/ping',
        headers: { origin: ORIGIN, 'access-control-request-method': method },
      })
      expect(response.headers['access-control-allow-methods']).toContain(method)
    }
    await app.close()
  })

  it('обычный ответ раскрывает браузеру X-Cart-Session-Token', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/ping', headers: { origin: ORIGIN } })
    expect(response.headers['access-control-expose-headers']).toContain('x-cart-session-token')
    await app.close()
  })

  it('чужой origin не получает access-control-allow-origin', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/ping', headers: { origin: 'https://evil.example.com' } })
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    await app.close()
  })
})
