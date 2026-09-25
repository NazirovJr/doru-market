/**
 * `rate-limit.integration.spec.ts` (DTJ-432). Rate-limit — сквозной плагин, поэтому поднимается
 * реальный `AppModule` через `createApp()`, а не урезанный harness. Каждый сценарий использует
 * свой `X-Forwarded-For`/`sub` — общий Redis-бакет иначе давал бы 429 независимо от порядка.
 */
import { randomInt, randomUUID, generateKeyPairSync } from 'node:crypto'
import { type Server } from 'node:http'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type Redis from 'ioredis'
import type { JwtClaims, JwtSignerPort } from '@/modules/auth/index.js'

const RATE_LIMIT_ANON_PER_MIN_TEST = 3
const RATE_LIMIT_USER_PER_MIN_TEST = 4
const RATE_LIMIT_1C_BATCH_PER_MIN_TEST = 2

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

function applyRequiredTestEnv(): void {
  const values: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: TEST_DATABASE_URL,
    CORS_STATIC_ORIGINS: process.env.CORS_STATIC_ORIGINS ?? 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_ANON_PER_MIN: String(RATE_LIMIT_ANON_PER_MIN_TEST),
    RATE_LIMIT_USER_PER_MIN: String(RATE_LIMIT_USER_PER_MIN_TEST),
    RATE_LIMIT_1C_BATCH_PER_MIN: String(RATE_LIMIT_1C_BATCH_PER_MIN_TEST),
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] ??= value
  }
  if (process.env.JWT_PRIVATE_KEY === undefined || process.env.JWT_PUBLIC_KEY === undefined) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    process.env.JWT_PRIVATE_KEY = privateKey
    process.env.JWT_PUBLIC_KEY = publicKey
    process.env.JWT_KID = 'test-v1'
  }
}

const PROBE_TIMEOUT_MS = 1_500

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

const FULL_BOOT_TIMEOUT_MS = 30_000

let ipCounter = 1
function nextTestIp(): string {
  ipCounter += 1
  return `10.66.${String((ipCounter >> 8) & 255)}.${String(ipCounter & 255)}`
}

const SEARCH_PATH = '/api/v1/medicines/search?q=paracetamol'

/** Свежий номер на тест — у OTP свой cooldown по телефону, общий литерал ловил бы его чужим 429. */
function randomTajikPhone(): string {
  const firstDigit = randomInt(3, 10)
  const rest = Array.from({ length: 8 }, () => randomInt(0, 10)).join('')
  return `+992${String(firstDigit)}${rest}`
}

interface RateLimitedErrorBody {
  readonly error: { readonly code: string }
}

describe.skipIf(!postgresAvailable)('Глобальный rate-limit — @fastify/rate-limit + Redis (DTJ-432)', () => {
  let app: NestFastifyApplication
  let httpServer: Server
  let redis: Redis
  let signToken: (sub: string) => string

  beforeAll(async () => {
    applyRequiredTestEnv()
    // Импорт ПОСЛЕ applyRequiredTestEnv() — граф модулей валидирует process.env при компиляции.
    const { createApp } = await import('@/main.js')
    const { REDIS_CLIENT } = await import('@/infrastructure/redis/redis.token.js')
    const { JWT_SIGNER } = await import('@/modules/auth/index.js')

    app = await createApp()
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    httpServer = app.getHttpServer()
    redis = app.get<Redis>(REDIS_CLIENT)
    const jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    signToken = (sub: string): string =>
      jwtSigner.sign({
        sub,
        role: 'customer',
        tenantId: null,
        pharmacyId: null,
        chainId: null,
        sessionId: randomUUID(),
      } satisfies JwtClaims)
  }, FULL_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await app.close()
    redis.disconnect()
  })

  it('AC1: анонимный лимит — (N+1)-й запрос с одного IP получает 429 RATE_LIMITED с Retry-After, предыдущие — с X-RateLimit-*', async () => {
    const ip = nextTestIp()
    const responses = []
    for (let i = 0; i < RATE_LIMIT_ANON_PER_MIN_TEST + 1; i += 1) {
      responses.push(await request(httpServer).get(SEARCH_PATH).set('X-Forwarded-For', ip))
    }
    const underLimit = responses.slice(0, RATE_LIMIT_ANON_PER_MIN_TEST)
    const overLimit = responses[RATE_LIMIT_ANON_PER_MIN_TEST]
    if (overLimit === undefined) throw new Error('expected an over-limit response')

    for (const res of underLimit) {
      expect(res.status).not.toBe(429)
      expect(res.headers['x-ratelimit-limit']).toBe(String(RATE_LIMIT_ANON_PER_MIN_TEST))
    }
    expect(overLimit.status).toBe(429)
    expect(overLimit.headers['retry-after']).toBeDefined()
    expect(overLimit.headers['x-ratelimit-limit']).toBe(String(RATE_LIMIT_ANON_PER_MIN_TEST))
    const body = overLimit.body as RateLimitedErrorBody
    expect(body.error.code).toBe('RATE_LIMITED')
  })

  it('AC2: два аутентифицированных пользователя за одним IP — каждый укладывается в СВОЙ userId-лимит', async () => {
    const ip = nextTestIp()
    const tokenA = signToken(randomUUID())
    const tokenB = signToken(randomUUID())

    for (let i = 0; i < RATE_LIMIT_USER_PER_MIN_TEST; i += 1) {
      const resA = await request(httpServer)
        .get(SEARCH_PATH)
        .set('X-Forwarded-For', ip)
        .set('Authorization', `Bearer ${tokenA}`)
      const resB = await request(httpServer)
        .get(SEARCH_PATH)
        .set('X-Forwarded-For', ip)
        .set('Authorization', `Bearer ${tokenB}`)
      expect(resA.status).not.toBe(429)
      expect(resB.status).not.toBe(429)
    }
  })

  it('AC3: превышенный лимит НЕ блокирует /health', async () => {
    const ip = nextTestIp()
    for (let i = 0; i < RATE_LIMIT_ANON_PER_MIN_TEST + 2; i += 1) {
      await request(httpServer).get(SEARCH_PATH).set('X-Forwarded-For', ip)
    }
    const health = await request(httpServer).get('/health').set('X-Forwarded-For', ip)
    expect(health.status).toBe(200)
  })

  it('внутренние маршруты (`/api/v1/internal/*`) и вебхук банка вне общего анонимного лимита', async () => {
    const ip = nextTestIp()
    for (let i = 0; i < RATE_LIMIT_ANON_PER_MIN_TEST + 2; i += 1) {
      await request(httpServer).get(SEARCH_PATH).set('X-Forwarded-For', ip)
    }
    const internalRes = await request(httpServer)
      .post(`/api/v1/internal/orders/${randomUUID()}/picking-sla-breach`)
      .set('X-Forwarded-For', ip)
      .send({})
    const webhookRes = await request(httpServer)
      .post('/api/v1/payments/webhook')
      .set('X-Forwarded-For', ip)
      .send({})
    expect(internalRes.status).not.toBe(429)
    expect(webhookRes.status).not.toBe(429)
  })

  it('AC4: повтор одного номера OTP — свой лимитер auth отдаёт 429 OTP_REQUEST_RATE_LIMITED как раньше, не задет глобальным rate-limit', async () => {
    const ip = nextTestIp()
    const phone = randomTajikPhone()
    const first = await request(httpServer).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone })
    expect(first.status).toBe(202)

    const second = await request(httpServer).post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone })
    expect(second.status).toBe(429)
    const body = second.body as RateLimitedErrorBody
    expect(body.error.code).toBe('OTP_REQUEST_RATE_LIMITED')
  })

  it('`@RateLimit` на POST /inventory/batch-update — свой (меньший) лимит по pharmacyId, отдельно от общего анонимного', async () => {
    const pharmacyKey = `dtj432-${randomUUID().slice(0, 8)}.secret`
    const ip = nextTestIp()
    const responses = []
    for (let i = 0; i < RATE_LIMIT_1C_BATCH_PER_MIN_TEST + 1; i += 1) {
      responses.push(
        await request(httpServer)
          .post('/api/v1/inventory/batch-update')
          .set('X-Forwarded-For', ip)
          .set('X-Pharmacy-API-Key', pharmacyKey)
          .set('X-Pharmacy-Timestamp', String(Date.now()))
          .set('X-Pharmacy-Nonce', randomUUID())
          .set('X-Pharmacy-Signature', 'invalid-signature-rate-limit-probe')
          .send({}),
      )
    }
    const underLimit = responses.slice(0, RATE_LIMIT_1C_BATCH_PER_MIN_TEST)
    const overLimit = responses[RATE_LIMIT_1C_BATCH_PER_MIN_TEST]
    if (overLimit === undefined) throw new Error('expected an over-limit response')

    // Подпись поддельная — guard отклонит её (401) ПОСЛЕ rate-limit; нас интересует именно 429.
    for (const res of underLimit) {
      expect(res.status).not.toBe(429)
    }
    expect(overLimit.status).toBe(429)

    // Анон-лимит на этом IP не тронут — ни одного запроса на /medicines/search ещё не было.
    const searchRes = await request(httpServer).get(SEARCH_PATH).set('X-Forwarded-For', ip)
    expect(searchRes.status).not.toBe(429)
  })
})
