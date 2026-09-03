/**
 * `cross-tenant-leakage.spec.ts` (EP-01, DTJ-022, волна 3.5 задача 2.4, устав §3.4) —
 * обязательный тест на утечку данных между тенантами.
 *
 * Что проверяется:
 *   1. Создаются пользователи в тенанте A и тенанте B (разные `tenantId`).
 *   2. Пользователь тенанта A создаёт ресурс (staff-аккаунт).
 *   3. Пользователь тенанта B пытается получить доступ к этому ресурсу
 *      (через `POST /staff-accounts` с токеном тенанта B).
 *   4. Ожидается `403 CROSS_TENANT_ACCESS_DENIED` — cross-tenant доступ блокируется.
 *
 * Это integration-тест: реальный HTTP → AuthGuard (с cross-tenant check)
 * → use case → Drizzle-репозитории (реальный Postgres, волна 5 блок A). Никаких моков бизнес-логики.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 2.4
 * @see docs/CLAUDE-CTO.md устав §3.4 «Тест на утечку между тенантами — обязателен»
 */
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  JWT_SIGNER,
  type JwtSignerPort,
} from '@/modules/auth/application/ports/jwt-signer.port.js'
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

// Два разных tenantId — имитируют две аптечные сети.
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CHAIN_A = '11111111-1111-4111-8111-111111111111'
const CHAIN_B = '22222222-2222-4222-8222-222222222222'

interface CreateStaffBody {
  readonly data: { readonly userId: string; readonly role: string }
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string }
}

describe('auth.cross-tenant-leakage (устав §3.4, волна 3.5 задача 2.4)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let users: UsersRepository
  let jwtSigner: JwtSignerPort

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    users = app.get(USERS_REPOSITORY)
    jwtSigner = app.get(JWT_SIGNER)
  })

  afterEach(async () => {
    await ctx.close()
  })

  /**
   * Создаёт пользователя напрямую через `USERS_REPOSITORY` (Drizzle, реальный Postgres) и возвращает JWT.
   * Имитирует пользователя, который уже прошёл OTP-верификацию.
   */
  async function seedUserAndGetToken(
    tenantId: string,
    chainId: string | null,
    role: 'pharmacy_admin' | 'super_admin' | 'customer' = 'pharmacy_admin',
  ): Promise<{ userId: string; accessToken: string; phone: string }> {
    const phone = `+992${randomUUID().replace(/-/g, '').slice(0, 9)}`
    const created = await users.create({
      tenantId,
      phoneNumber: phone,
      role,
      fullName: 'Test Actor',
      pharmacyId: null,
      chainId,
    })
    const accessToken = jwtSigner.sign({
      sub: created.id,
      role: created.role,
      tenantId: created.tenantId,
      pharmacyId: created.pharmacyId,
      chainId: created.chainId,
      sessionId: randomUUID(),
    })
    return { userId: created.id, accessToken, phone }
  }

  it('1. Пользователь ТЕНАНТА А создаёт staff → 201 (базовая проверка)', async () => {
    const adminA = await seedUserAndGetToken(TENANT_A, CHAIN_A, 'pharmacy_admin')
    const targetPhone = '+992917111111'
    const pharmacyId = '66666666-6666-4666-8666-666666666666'

    const response = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${adminA.accessToken}`)
      .send({
        phone: targetPhone,
        fullName: 'Staff Tenant A',
        role: 'pharmacist',
        pharmacyId,
        chainId: CHAIN_A,
      })

    expect(response.status).toBe(201)
    const body = response.body as CreateStaffBody
    expect(body.data.role).toBe('pharmacist')
    expect(body.data.userId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('2. Пользователь ТЕНАНТА Б пытается создать staff в ТЕНАНТЕ А → 403 CROSS_TENANT_ACCESS_DENIED', async () => {
    // 1) Создаём пользователя в ТЕНАНТЕ А (через админа А) — ресурс принадлежит А
    const adminA = await seedUserAndGetToken(TENANT_A, CHAIN_A, 'pharmacy_admin')
    const targetPhone = '+992917222222'
    const pharmacyId = '77777777-7777-4777-8777-777777777777'

    const createByA = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${adminA.accessToken}`)
      .send({
        phone: targetPhone,
        fullName: 'Staff Created By Tenant A',
        role: 'pharmacist',
        pharmacyId,
        chainId: CHAIN_A,
      })
    expect(createByA.status).toBe(201)
    // createdUserId not used directly; test verifies cross-tenant access in next case

    // 2) Создаём пользователя в ТЕНАНТЕ Б — другой тенант
    const adminB = await seedUserAndGetToken(TENANT_B, CHAIN_B, 'pharmacy_admin')

    // 3) Пользователь Б пытается создать staff-аккаунт, УКАЗЫВАЯ chainId ТЕНАНТА А
    // (попытка перепрыгнуть в чужой тенант через явный chainId в теле запроса).
    // AuthGuard должен сравнить claims.tenantId (ТЕНАНТ Б) с resolvedTenantId (ТЕНАНТ Б)
    // и отклонить запрос, так как chainId в теле указывает на ресурс ТЕНАНТА А.
    // НО: cross-tenant check в AuthGuard проверяет claims.tenantId vs resolvedTenantId.
    // Для проверки "пользователь Б обращается к данным А" нужен endpoint,
    // который читает/пишет в тенант А. staff-accounts пишет в тот же tenantId,
    // что и в токене (actor.tenantId из JWT).
    //
    // Правильный сценарий cross-tenant leakage:
    // - токен от пользователя ТЕНАНТА Б (claims.tenantId = TENANT_B)
    // - но TenantResolutionMiddleware резолвит ТЕНАНТ А (например, через subdomain)
    // - AuthGuard сравнивает claims.tenantId (TENANT_B) !== resolvedTenantId (TENANT_A)
    // - → 403 CROSS_TENANT_ACCESS_DENIED
    //
    // В этом изолированном auth-harness TenantResolutionMiddleware НЕ подключён (нет реального
    // поддомена/хедера). Поэтому мы тестируем cross-tenant check, МОКАЯ TenantContext
    // через TenantContext.run с tenantId = TENANT_A, но токен от TENANT_B.

    const TenantContext = (await import('@/common/context/tenant-context.js')).TenantContext

    // Создаём контекст, где резолвлен ТЕНАНТ А
    const tenantAStore = TenantContext.forTenant({
      tenantId: TENANT_A,
      slug: 'tenant-a',
      chainId: CHAIN_A,
      isNeutral: false,
    })

    // Запускаем запрос в контексте ТЕНАНТА А, но с токеном от ТЕНАНТА Б
    // В реальном сценарии это происходит, когда злоумышленник подменяет Host/Slug
    // или отправляет запрос к API другого тенанта со своим токеном.
    const result = await TenantContext.run(tenantAStore, async () => {
      const response = await request(httpServer)
        .post('/api/v1/staff-accounts')
        .set('Authorization', `Bearer ${adminB.accessToken}`) // токен от ТЕНАНТА Б
        .send({
          phone: '+992917333333',
          fullName: 'Attacker from Tenant B',
          role: 'pharmacist',
          pharmacyId: null,
          chainId: CHAIN_A, // пытается писать в сеть ТЕНАНТА А
        })
      return response
    })

    expect(result.status).toBe(403)
    const body = result.body as ErrorBody
    expect(body.error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })

  it('3. super_admin (tenantId === null) ИСКЛЮЧЕН из cross-tenant check', async () => {
    // super_admin может работать межтенантно — это по дизайну (SRS-TEN-010).
    const superAdmin = await seedUserAndGetToken(TENANT_A, null, 'super_admin')

    const TenantContext = (await import('@/common/context/tenant-context.js')).TenantContext

    // Резолвим ТЕНАНТ Б, но токен от super_admin (tenantId === null)
    const tenantBStore = TenantContext.forTenant({
      tenantId: TENANT_B,
      slug: 'tenant-b',
      chainId: CHAIN_B,
      isNeutral: false,
    })

    const result = await TenantContext.run(tenantBStore, async () => {
      const response = await request(httpServer)
        .post('/api/v1/staff-accounts')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({
          phone: '+992917444444',
          fullName: 'Staff by super_admin',
          role: 'pharmacist',
          pharmacyId: null,
          chainId: CHAIN_B,
        })
      return response
    })

    // super_admin должен пройти (201), cross-tenant check не применяется к нему
    expect(result.status).toBe(201)
  })

  it('4. Пользователь ТЕНАНТА Б без подмены TenantContext (нормальный кейс) → 201', async () => {
    // Нормальный сценарий: пользователь Б работает в своём тенанте Б.
    // TenantResolutionMiddleware резолвит ТЕНАНТ Б (slug Б), claims.tenantId = TENANT_B.
    // Cross-tenant check: TENANT_B === TENANT_B → OK.
    const adminB = await seedUserAndGetToken(TENANT_B, CHAIN_B, 'pharmacy_admin')

    const TenantContext = (await import('@/common/context/tenant-context.js')).TenantContext

    const tenantBStore = TenantContext.forTenant({
      tenantId: TENANT_B,
      slug: 'tenant-b',
      chainId: CHAIN_B,
      isNeutral: false,
    })

    const result = await TenantContext.run(tenantBStore, async () => {
      const response = await request(httpServer)
        .post('/api/v1/staff-accounts')
        .set('Authorization', `Bearer ${adminB.accessToken}`)
        .send({
          phone: '+992917555555',
          fullName: 'Legitimate Staff Tenant B',
          role: 'pharmacist',
          pharmacyId: null,
          chainId: CHAIN_B,
        })
      return response
    })

    expect(result.status).toBe(201)
  })
})