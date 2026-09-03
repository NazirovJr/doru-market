/**
 * `get-me.spec.ts` (EP-01, DTJ-028 follow-up, SRS-API-025) — сквозной
 * integration-тест `GET /api/v1/auth/me`.
 *
 * Сценарии:
 *   1. happy: логин через OTP → GET /auth/me с accessToken → 200 + user
 *      (id, role, tenantId, phoneNumber, fullName, ...);
 *   2. без Authorization → 401 UNAUTHENTICATED (AuthGuard);
 *   3. user изменился между выдачей токена и запросом: userId не найден в
 *      `users` → 401 TOKEN_INVALID (TokenInvalidatedError), не NOT_FOUND;
 *   4. role-проверка: customer (минимальная роль) тоже может вызвать
 *      `/auth/me` (нет @RolesGuard на endpoint).
 */
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  JWT_SIGNER,
  type JwtSignerPort,
} from '@/modules/auth/application/ports/jwt-signer.port.js'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { users as usersTable } from '@/db/schema/users.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const CHAIN_A = '11111111-1111-4111-8111-111111111111'

interface RequestOtpBody {
  readonly data: { readonly otpRequestId: string }
}
interface VerifyOtpBody {
  readonly data: {
    readonly accessToken: string
    readonly refreshToken: string
    readonly user: { readonly id: string }
  }
}
interface MeBody {
  readonly data: {
    readonly id: string
    readonly role: string
    readonly tenantId: string | null
    readonly phoneNumber: string | null
    readonly fullName: string | null
  }
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string }
}

describe('auth.me (DTJ-028 follow-up, SRS-API-025)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let sms: SmsProviderPort & { peekLast: () => { code: string } | null }
  let users: UsersRepository
  let jwtSigner: JwtSignerPort
  let db: DrizzleDb

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    sms = app.get<unknown>(SMS_PROVIDER) as SmsProviderPort & {
      peekLast: () => { code: string } | null
    }
    users = app.get(USERS_REPOSITORY)
    jwtSigner = app.get(JWT_SIGNER)
    db = app.get<DrizzleDb>(DRIZZLE_DB)
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('1. happy: OTP-login → GET /auth/me → 200 + user', async () => {
    const phone = '+992917123456'
    const otpReq = await request(httpServer)
      .post('/api/v1/auth/otp/request')
      .send({ phone })
      .expect(202)
    const otpRequestId = (otpReq.body as RequestOtpBody).data.otpRequestId
    const code = sms.peekLast()?.code
    expect(code).toBeDefined()
    const verify = await request(httpServer)
      .post('/api/v1/auth/otp/verify')
      .send({ otpRequestId, code })
      .expect(200)
    const accessToken = (verify.body as VerifyOtpBody).data.accessToken

    const me = await request(httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(me.status).toBe(200)
    const body = me.body as MeBody
    expect(body.data.phoneNumber).toBe(phone)
    expect(body.data.role).toBe('customer')
    expect(body.data.tenantId).toBeTruthy()
    expect(body.data.fullName).toBeDefined()
  })

  it('2. без Authorization → 401 UNAUTHENTICATED', async () => {
    const me = await request(httpServer).get('/api/v1/auth/me')
    expect(me.status).toBe(401)
    const body = me.body as ErrorBody
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('3. user был удалён между выдачей токена и запросом → 401 TOKEN_INVALID', async () => {
    // 1) Создаём user через users.create напрямую.
    const created = await users.create({
      tenantId: TENANT_ID,
      phoneNumber: '+992917999888',
      role: 'customer',
      fullName: 'Test User',
      pharmacyId: null,
      chainId: CHAIN_A,
    })
    // 2) Выписываем валидный accessToken для этого user.
    const accessToken = jwtSigner.sign({
      sub: created.id,
      role: created.role,
      tenantId: created.tenantId,
      pharmacyId: created.pharmacyId,
      chainId: created.chainId,
      sessionId: randomUUID(),
    })
    // 3) Симулируем soft-delete: обновляем строку напрямую через Drizzle
    // (DrizzleUsersRepository — реальный Postgres, волна 5 блок A; `UpdateUserPatch`
    // порта не несёт `deletedAt` — это R2 профиль-редактирование, не soft-delete).
    // findById фильтрует `deletedAt IS NOT NULL`, поэтому GetMeUseCase не найдёт.
    await db.update(usersTable).set({ deletedAt: new Date() }).where(eq(usersTable.id, created.id))
    // 4) Запрос /auth/me → 401 TOKEN_INVALID.
    const me = await request(httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(me.status).toBe(401)
    const body = me.body as ErrorBody
    expect(body.error.code).toBe('TOKEN_INVALID')
  })

  it('4. role: customer тоже имеет доступ (нет @RolesGuard)', async () => {
    const created = await users.create({
      tenantId: TENANT_ID,
      phoneNumber: '+992917111222',
      role: 'customer',
      fullName: 'Customer',
      pharmacyId: null,
      chainId: null,
    })
    const accessToken = jwtSigner.sign({
      sub: created.id,
      role: created.role,
      tenantId: created.tenantId,
      pharmacyId: created.pharmacyId,
      chainId: created.chainId,
      sessionId: randomUUID(),
    })
    const me = await request(httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(me.status).toBe(200)
    const body = me.body as MeBody
    expect(body.data.role).toBe('customer')
  })

  it('5. role: pharmacist (созданный через /staff-accounts) тоже имеет доступ', async () => {
    // Создаём pharmacy_admin actor для создания staff.
    const admin = await users.create({
      tenantId: TENANT_ID,
      phoneNumber: '+992917333444',
      role: 'pharmacy_admin',
      fullName: 'Admin',
      pharmacyId: null,
      chainId: CHAIN_A,
    })
    const adminToken = jwtSigner.sign({
      sub: admin.id,
      role: admin.role,
      tenantId: admin.tenantId,
      pharmacyId: admin.pharmacyId,
      chainId: admin.chainId,
      sessionId: randomUUID(),
    })
    // Создаём pharmacist через /staff-accounts.
    const create = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        phone: '+992917555666',
        fullName: 'Pharmacist',
        role: 'pharmacist',
        pharmacyId: '66666666-6666-4666-8666-666666666666',
        chainId: CHAIN_A,
      })
    expect(create.status).toBe(201)
    // Pharmacist делает OTP-login и GET /me.
    const otpReq = await request(httpServer)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+992917555666' })
      .expect(202)
    const otpRequestId = (otpReq.body as RequestOtpBody).data.otpRequestId
    const code = sms.peekLast()?.code
    expect(code).toBeDefined()
    const verify = await request(httpServer)
      .post('/api/v1/auth/otp/verify')
      .send({ otpRequestId, code })
      .expect(200)
    const accessToken = (verify.body as VerifyOtpBody).data.accessToken
    const me = await request(httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(me.status).toBe(200)
    const body = me.body as MeBody
    expect(body.data.role).toBe('pharmacist')
    expect(body.data.fullName).toBe('Pharmacist')
  })
})
