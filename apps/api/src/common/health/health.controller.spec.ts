/**
 * Интеграционный тест `GET /health`/`GET /ready` (тест-план DTJ-001). Реального Postgres/Redis
 * в этой песочнице нет (нет запущенного Docker-демона) — Postgres/Redis индикаторы
 * подменяются DI-фейками, вся остальная цепочка (HTTP → Nest → Terminus → HealthController)
 * реальная. Критерии приёмки №1/№2 тикета проверяются буквально: `/health` всегда `200`
 * с телом `{ data: { status: 'ok' } }`; `/ready` — `503` с явной детализацией по каждой
 * зависимости, когда одна из них недоступна, при этом вторая отдельно помечена `up`.
 */
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type { HealthIndicatorResult } from '@nestjs/terminus'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthModule } from '@/common/health/health.module'
import { PostgresReadinessIndicator } from '@/common/health/postgres-readiness.indicator'
import { RedisReadinessIndicator } from '@/common/health/redis-readiness.indicator'

interface ReadinessResponseBody {
  readonly status: 'ok' | 'error'
  readonly details: Record<string, { readonly status: 'up' | 'down'; readonly message?: string }>
}

const up = (key: string): HealthIndicatorResult => ({ [key]: { status: 'up' } })
const down = (key: string, message: string): HealthIndicatorResult => ({ [key]: { status: 'down', message } })

describe('HealthController (GET /health, GET /ready)', () => {
  let app: INestApplication
  let httpServer: Server
  let postgresCheck: ReturnType<typeof vi.fn<() => Promise<HealthIndicatorResult>>>
  let redisCheck: ReturnType<typeof vi.fn<() => Promise<HealthIndicatorResult>>>

  beforeEach(async () => {
    postgresCheck = vi.fn().mockResolvedValue(up('postgres'))
    redisCheck = vi.fn().mockResolvedValue(up('redis'))

    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] })
      .overrideProvider(PostgresReadinessIndicator)
      .useValue({ check: postgresCheck })
      .overrideProvider(RedisReadinessIndicator)
      .useValue({ check: redisCheck })
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready()
    httpServer = app.getHttpServer() as Server
  })

  afterEach(async () => {
    await app.close()
  })

  it('критерий №1: GET /health — всегда 200 { data: { status: "ok" } }', async () => {
    const response = await request(httpServer).get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { status: 'ok' } })
  })

  it('GET /ready — 200, когда Postgres и Redis живы', async () => {
    const response = await request(httpServer).get('/ready')

    expect(response.status).toBe(200)
  })

  it('критерий №2: GET /ready — 503, Postgres явно down, Redis отдельно помечен up', async () => {
    postgresCheck.mockResolvedValue(down('postgres', 'connection refused'))

    const response = await request(httpServer).get('/ready')
    const body = response.body as ReadinessResponseBody

    expect(response.status).toBe(503)
    expect(body.details.postgres?.status).toBe('down')
    expect(body.details.redis?.status).toBe('up')
  })

  it('GET /ready — 503, Redis явно down, Postgres отдельно помечен up', async () => {
    redisCheck.mockResolvedValue(down('redis', 'ECONNREFUSED'))

    const response = await request(httpServer).get('/ready')
    const body = response.body as ReadinessResponseBody

    expect(response.status).toBe(503)
    expect(body.details.redis?.status).toBe('down')
    expect(body.details.postgres?.status).toBe('up')
  })
})
