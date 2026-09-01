/**
 * `create-staff-account.spec.ts` (EP-01, DTJ-030, SRS-API-035) — сквозной
 * integration-тест административного создания staff-аккаунта.
 *
 * Сценарии:
 *   A. happy path: pharmacy_admin (chainId=A) логинится через OTP, получает
 *      accessToken, делает `POST /api/v1/staff-accounts` с role=pharmacist +
 *      chainId=A → 201 { userId, role: 'pharmacist' }.
 *   B. Проверяется, что созданный pharmacist может ЗАЛОГИНИТЬСЯ через
 *      /auth/otp/request → /auth/otp/verify и получить JWT с role=pharmacist,
 *      chainId=A (т.е. полный цикл «admin создал → сотрудник вошёл»).
 *   C. policy fail: pharmacy_admin (chainId=A) создаёт pharmacist в
 *      chainId=B → 403 FORBIDDEN.
 *   D. cross-role: customer (без прав) пытается создать pharmacist → 403
 *      INSUFFICIENT_ROLE (RolesGuard), НЕ FORBIDDEN.
 *   E. duplicate: pharmacy_admin создаёт pharmacist на тот же phone →
 *      409 CONFLICT.
 *   F. invalid phone → 400 INVALID_PHONE_FORMAT.
 *
 * Все тесты идут через `Test.createTestingModule` + `supertest` — без моков
 * use case'ов (т.к. InMemory-репозитории уже дают реальный «БД»-уровень).
 * `pharmacy_admin` actor создаётся вручную через прямой INSERT в
 * InMemoryUsersRepository (см. `seedPharmacyAdmin`), минуя OTP-путь,
 * чтобы тест был компактным.
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
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const CHAIN_A = '11111111-1111-4111-8111-111111111111'
const CHAIN_B = '22222222-2222-4222-8222-222222222222'

interface RequestOtpBody {
  readonly data: { readonly otpRequestId: string }
}
interface VerifyOtpBody {
  readonly data: {
    readonly accessToken: string
    readonly refreshToken: string
    readonly user: { readonly id: string; readonly role: string }
  }
}
interface CreateStaffBody {
  readonly data: { readonly userId: string; readonly role: string }
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string }
}

describe('auth.create-staff-account (DTJ-030, SRS-API-035/036)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let sms: SmsProviderPort & { peekLast: () => { code: string } | null }
  let users: UsersRepository
  let jwtSigner: JwtSignerPort

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    sms = app.get<unknown>(SMS_PROVIDER) as SmsProviderPort & {
      peekLast: () => { code: string } | null
    }
    users = app.get(USERS_REPOSITORY)
    jwtSigner = app.get(JWT_SIGNER)
  })

  afterEach(async () => {
    await ctx.close()
  })

  /**
   * Создаёт в InMemory `users` запись напрямую (минуя HTTP) и возвращает
   * `accessToken` этого пользователя, выписанный `JWT_SIGNER`. Это позволяет
   * тесту не идти по полному OTP-циклу для actor'а, и сразу проверять
   * `POST /api/v1/staff-accounts` с правильным `Authorization: Bearer`.
   */
  async function seedPharmacyAdminAndGetToken(
    role: 'pharmacy_admin' | 'super_admin' | 'customer' = 'pharmacy_admin',
    chainId: string | null = CHAIN_A,
  ): Promise<{ userId: string; accessToken: string; phone: string }> {
    const phone = `+992${randomUUID().replace(/-/g, '').slice(0, 9)}`
    const created = await users.create({
      tenantId: TENANT_ID,
      phoneNumber: phone,
      role,
      fullName: 'Test Actor',
      pharmacyId: null,
      chainId,
    })
    // JwtSignerPort.sign(claims) — синхронный, возвращает строку токена
    // напрямую. `sessionId` обязателен по `JwtClaims` (DTJ-022), используем
    // randomUUID как placeholder (для test'а значение не проверяется,
    // потому что staff-accounts endpoint читает только sub/role/tenantId).
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

  it('A. pharmacy_admin создаёт pharmacist в СВОЕЙ сети → 201', async () => {
    const admin = await seedPharmacyAdminAndGetToken('pharmacy_admin', CHAIN_A)
    const targetPhone = '+992917123456'
    const pharmacyId = '66666666-6666-4666-8666-666666666666'

    const response = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        phone: targetPhone,
        fullName: 'Иванов Иван',
        role: 'pharmacist',
        pharmacyId,
        chainId: CHAIN_A,
      })
    expect(response.status).toBe(201)
    const body = response.body as CreateStaffBody
    expect(body.data.role).toBe('pharmacist')
    expect(body.data.userId).toMatch(/^[0-9a-f-]{36}$/i)

    // Проверяем, что user реально сохранён с правильным role + chainId.
    const saved = await users.findById(body.data.userId)
    expect(saved?.role).toBe('pharmacist')
    expect(saved?.chainId).toBe(CHAIN_A)
    expect(saved?.pharmacyId).toBe(pharmacyId)
  })

  it('B. happy end-to-end: admin создал pharmacist → pharmacist входит через OTP → JWT с role=pharmacist', async () => {
    const admin = await seedPharmacyAdminAndGetToken('pharmacy_admin', CHAIN_A)
    const targetPhone = '+992917999000'
    const pharmacyId = '77777777-7777-4777-8777-777777777777'

    // 1) admin создаёт pharmacist
    const create = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        phone: targetPhone,
        fullName: 'Сотрудник',
        role: 'pharmacist',
        pharmacyId,
        chainId: CHAIN_A,
      })
    expect(create.status).toBe(201)

    // 2) pharmacist запрашивает OTP
    const otpReq = await request(httpServer)
      .post('/api/v1/auth/otp/request')
      .send({ phone: targetPhone })
    expect(otpReq.status).toBe(202)
    const otpRequestId = (otpReq.body as RequestOtpBody).data.otpRequestId
    const code = sms.peekLast()?.code
    expect(code).toBeDefined()

    // 3) pharmacist верифицирует OTP
    const verify = await request(httpServer)
      .post('/api/v1/auth/otp/verify')
      .send({ otpRequestId, code })
    expect(verify.status).toBe(200)
    const vBody = (verify.body as VerifyOtpBody).data
    expect(vBody.user.role).toBe('pharmacist')

    // 4) Проверяем, что в JWT указана правильная role.
    // verify возвращает accessToken; декодируем через `jwtSigner.verify`
    // (НЕ парсим вручную через base64, чтобы не зависеть от подписи).
    const decoded = jwtSigner.verify(vBody.accessToken)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.role).toBe('pharmacist')
    expect(decoded.value.chainId).toBe(CHAIN_A)
  })

  it('C. pharmacy_admin (chainA) → pharmacist в chainB → 403 FORBIDDEN', async () => {
    const admin = await seedPharmacyAdminAndGetToken('pharmacy_admin', CHAIN_A)
    const response = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        phone: '+992917222222',
        fullName: 'X',
        role: 'pharmacist',
        pharmacyId: null,
        chainId: CHAIN_B,
      })
    expect(response.status).toBe(403)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('D. customer → любая роль → 403 INSUFFICIENT_ROLE (RolesGuard, а не policy)', async () => {
    const customer = await seedPharmacyAdminAndGetToken('customer', null)
    const response = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        phone: '+992917333333',
        fullName: 'X',
        role: 'pharmacist',
        chainId: null,
      })
    expect(response.status).toBe(403)
    const body = response.body as ErrorBody
    // RolesGuard кидает именно INSUFFICIENT_ROLE (грубая проверка),
    // а НЕ FORBIDDEN (тонкая policy-проверка).
    expect(body.error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('E. duplicate phone в том же tenant → 409 CONFLICT', async () => {
    const admin = await seedPharmacyAdminAndGetToken('pharmacy_admin', CHAIN_A)
    const phone = '+992917444444'

    // 1-й — успех.
    const first = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ phone, fullName: 'Первый', role: 'pharmacist', chainId: CHAIN_A })
    expect(first.status).toBe(201)

    // 2-й — 409.
    const second = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ phone, fullName: 'Второй', role: 'pharmacist', chainId: CHAIN_A })
    expect(second.status).toBe(409)
    const body = second.body as ErrorBody
    expect(body.error.code).toBe('CONFLICT')
  })

  it('F. invalid phone → 400 INVALID_PHONE_FORMAT', async () => {
    const admin = await seedPharmacyAdminAndGetToken('pharmacy_admin', CHAIN_A)
    const response = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        phone: 'not-a-phone',
        fullName: 'X',
        role: 'pharmacist',
        chainId: CHAIN_A,
      })
    expect(response.status).toBe(400)
    const body = response.body as ErrorBody
    expect(['INVALID_PHONE_FORMAT', 'VALIDATION_ERROR']).toContain(body.error.code)
  })

  it('G. без Authorization → 401 UNAUTHENTICATED (AuthGuard)', async () => {
    const response = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .send({
        phone: '+992917555555',
        fullName: 'X',
        role: 'pharmacist',
        chainId: CHAIN_A,
      })
    expect(response.status).toBe(401)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })
})
