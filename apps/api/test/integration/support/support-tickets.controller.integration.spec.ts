/**
 * `SupportTicketsController` — Supertest integration (EP-14, DTJ-282, тест-план тикета) против
 * РЕАЛЬНЫХ Postgres/Redis (тот же `createTestApp()`, что `pharmacy-terminal-queue.controller.
 * integration.spec.ts`, DTJ-301).
 *
 * Покрывает АС1-АС4 DTJ-282 + тест-план (пагинация курсор, комбинация фильтров, маппинг
 * доменных ошибок → HTTP, RBAC-негативные сценарии по каждому из 5 эндпоинтов).
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.SUPPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
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

interface SuccessBody<T> {
  readonly data: T
  readonly meta?: Record<string, unknown>
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
}
interface TicketBody {
  readonly id: string
  readonly status: string
  readonly priority: number
  readonly isEscrowBlocking: boolean
  readonly firstRespondedAt: string | null
  readonly messages: readonly { readonly id: string; readonly body: string; readonly authorRole: string }[]
}

const TENANT_ID = randomUUID()
const OTHER_TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable)('SupportTicketsController — Supertest integration (DTJ-282)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const createdUserIds: string[] = []
  const createdTicketIds: string[] = []

  async function seedUser(role: string, tenantId: string = TENANT_ID): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`,
      [id, tenantId, `+99290${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`, role],
    )
    createdUserIds.push(id)
    return id
  }

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  function tokenFor(role: string, userId: string, tenantId: string = TENANT_ID): string {
    return sign({ sub: userId, role: role as JwtClaims['role'], tenantId, pharmacyId: null, chainId: null })
  }

  function createReq(token: string, body: Record<string, unknown>): request.Test {
    return request(httpServer).post('/api/v1/support-tickets').set('Authorization', `Bearer ${token}`).send(body)
  }
  function listReq(token: string, query = ''): request.Test {
    return request(httpServer).get(`/api/v1/support-tickets${query}`).set('Authorization', `Bearer ${token}`)
  }
  function detailReq(token: string, id: string): request.Test {
    return request(httpServer).get(`/api/v1/support-tickets/${id}`).set('Authorization', `Bearer ${token}`)
  }
  function addMessageReq(token: string, id: string, body: string): request.Test {
    return request(httpServer)
      .post(`/api/v1/support-tickets/${id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body })
  }
  function changeStatusReq(token: string, id: string, status: string): request.Test {
    return request(httpServer)
      .post(`/api/v1/support-tickets/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status })
  }

  async function createTicket(token: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await createReq(token, { channel: 'in_app', category: 'other', description: 'seed ticket', ...overrides })
    const id = (res.body as SuccessBody<TicketBody>).data.id
    createdTicketIds.push(id)
    return id
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      `test-support-282-${TENANT_ID.slice(0, 8)}`,
    ])
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      OTHER_TENANT_ID,
      `test-support-282-other-${OTHER_TENANT_ID.slice(0, 8)}`,
    ])
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM support_ticket_messages WHERE ticket_id = ANY($1)', [createdTicketIds])
      await pool.query('DELETE FROM support_tickets WHERE id = ANY($1)', [createdTicketIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[TENANT_ID, OTHER_TENANT_ID]])
      await pool.end().catch(() => undefined)
    }
  })

  it('AC1 — customer POST / c category=courier_conduct → 201, SupportTicketDto с isEscrowBlocking=false', async () => {
    const customerId = await seedUser('customer')
    const token = tokenFor('customer', customerId)

    const res = await createReq(token, { channel: 'in_app', category: 'courier_conduct', description: 'курьер грубил' })

    expect(res.status).toBe(201)
    const body = (res.body as SuccessBody<TicketBody>).data
    createdTicketIds.push(body.id)
    expect(body.isEscrowBlocking).toBe(false)
    expect(body.status).toBe('open')
    expect(body.messages).toEqual([])
  })

  it('AC2 — support_agent видит тикеты ВСЕХ клиентов своего тенанта, но НЕ чужого тенанта', async () => {
    const customerA = await seedUser('customer')
    const customerB = await seedUser('customer')
    const foreignCustomer = await seedUser('customer', OTHER_TENANT_ID)
    const agent = await seedUser('support_agent')
    const ticketA = await createTicket(tokenFor('customer', customerA))
    const ticketB = await createTicket(tokenFor('customer', customerB))
    const foreignTicket = await createTicket(tokenFor('customer', foreignCustomer, OTHER_TENANT_ID), {})

    const res = await listReq(tokenFor('support_agent', agent), '?status=open&limit=50')

    expect(res.status).toBe(200)
    const ids = (res.body as SuccessBody<readonly TicketBody[]>).data.map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining([ticketA, ticketB]))
    expect(ids).not.toContain(foreignTicket)
  })

  it('customer видит В СПИСКЕ только СВОИ тикеты (не других клиентов своего тенанта)', async () => {
    const customerA = await seedUser('customer')
    const customerB = await seedUser('customer')
    const ticketA = await createTicket(tokenFor('customer', customerA))
    const ticketB = await createTicket(tokenFor('customer', customerB))

    const res = await listReq(tokenFor('customer', customerA), '?limit=50')

    const ids = (res.body as SuccessBody<readonly TicketBody[]>).data.map((t) => t.id)
    expect(ids).toContain(ticketA)
    expect(ids).not.toContain(ticketB)
  })

  it('AC3 — customer, не владеющий тикетом, GET /:id → 403; владелец → 200', async () => {
    const owner = await seedUser('customer')
    const stranger = await seedUser('customer')
    const ticketId = await createTicket(tokenFor('customer', owner))

    const forbidden = await detailReq(tokenFor('customer', stranger), ticketId)
    expect(forbidden.status).toBe(403)

    const allowed = await detailReq(tokenFor('customer', owner), ticketId)
    expect(allowed.status).toBe(200)
    expect((allowed.body as SuccessBody<TicketBody>).data.id).toBe(ticketId)
  })

  it('GET /:id отсутствующего тикета → 404 TICKET_NOT_FOUND', async () => {
    const agent = await seedUser('support_agent')
    const res = await detailReq(tokenFor('support_agent', agent), randomUUID())
    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('TICKET_NOT_FOUND')
  })

  it('AC4 — тикет уже closed, support_agent POST /:id/status {in_progress} → 409 TICKET_ALREADY_TERMINAL', async () => {
    const customerId = await seedUser('customer')
    const agent = await seedUser('support_agent')
    const ticketId = await createTicket(tokenFor('customer', customerId))
    const agentToken = tokenFor('support_agent', agent)
    expect((await changeStatusReq(agentToken, ticketId, 'resolved')).status).toBe(200)
    expect((await changeStatusReq(agentToken, ticketId, 'closed')).status).toBe(200)

    const res = await changeStatusReq(agentToken, ticketId, 'in_progress')

    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('TICKET_ALREADY_TERMINAL')
  })

  it('customer (не support_agent/super_admin) POST /:id/status → 403 INSUFFICIENT_ROLE', async () => {
    const customerId = await seedUser('customer')
    const ticketId = await createTicket(tokenFor('customer', customerId))

    const res = await changeStatusReq(tokenFor('customer', customerId), ticketId, 'in_progress')

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('POST /:id/messages — support_agent отвечает первым → firstRespondedAt заполняется, сообщение в ленте', async () => {
    const customerId = await seedUser('customer')
    const agent = await seedUser('support_agent')
    const ticketId = await createTicket(tokenFor('customer', customerId))

    const res = await addMessageReq(tokenFor('support_agent', agent), ticketId, 'Разбираемся, скоро ответим')

    expect(res.status).toBe(201)
    const body = (res.body as SuccessBody<TicketBody>).data
    expect(body.firstRespondedAt).not.toBeNull()
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]).toMatchObject({ body: 'Разбираемся, скоро ответим', authorRole: 'support_agent' })
  })

  it('POST /:id/messages — владелец (customer) дописывает в СВОЙ тикет → 201', async () => {
    const customerId = await seedUser('customer')
    const ticketId = await createTicket(tokenFor('customer', customerId))

    const res = await addMessageReq(tokenFor('customer', customerId), ticketId, 'Дополнение к обращению')

    expect(res.status).toBe(201)
    expect((res.body as SuccessBody<TicketBody>).data.messages).toHaveLength(1)
  })

  it('POST /:id/messages — чужой customer (не владелец, не staff) → 403', async () => {
    const owner = await seedUser('customer')
    const stranger = await seedUser('customer')
    const ticketId = await createTicket(tokenFor('customer', owner))

    const res = await addMessageReq(tokenFor('customer', stranger), ticketId, 'left field')

    expect(res.status).toBe(403)
  })

  it('пагинация — limit=1 → hasMore=true и nextCursor присутствует; вторая страница отдаёт остаток без дублей', async () => {
    const customerId = await seedUser('customer')
    const token = tokenFor('customer', customerId)
    const ticket1 = await createTicket(token)
    const ticket2 = await createTicket(token)

    const page1 = await listReq(token, '?limit=1')
    expect(page1.status).toBe(200)
    const page1Body = page1.body as SuccessBody<readonly TicketBody[]>
    expect(page1Body.data).toHaveLength(1)
    const pagination = page1Body.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
    expect(pagination?.hasMore).toBe(true)
    expect(pagination?.nextCursor).not.toBeNull()

    const page2 = await listReq(token, `?limit=10&cursor=${encodeURIComponent(pagination?.nextCursor ?? '')}`)
    const page2Ids = (page2.body as SuccessBody<readonly TicketBody[]>).data.map((t) => t.id)
    // Курсор продвигается: страница 2 отдаёт ОСТАВШИЙСЯ тикет (не оба — тот же, что уже был на
    // странице 1, туда не должен вернуться), объединение обеих страниц покрывает оба без дублей.
    const combinedIds = [...page1Body.data.map((t) => t.id), ...page2Ids]
    expect(new Set(combinedIds)).toEqual(new Set([ticket1, ticket2]))
    expect(new Set(combinedIds).size).toBe(combinedIds.length)
  })

  it('фильтры status+category комбинируются (AND, не OR)', async () => {
    const customerId = await seedUser('customer')
    const token = tokenFor('customer', customerId)
    const matching = await createTicket(token, { category: 'payment_issue' })
    await createTicket(token, { category: 'other' })

    const res = await listReq(token, '?status=open&category=payment_issue&limit=50')

    const ids = (res.body as SuccessBody<readonly TicketBody[]>).data.map((t) => t.id)
    expect(ids).toEqual([matching])
  })
})
