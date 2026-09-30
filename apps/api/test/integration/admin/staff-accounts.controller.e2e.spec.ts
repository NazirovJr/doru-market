// DTJ-364: реальная БД/Redис — create (DTJ-030) → list/deactivate/provision-courier. randomUUID()
// данные — общая dorutj_test, параллельные исполнители.
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AUTH_SESSIONS_REPOSITORY,
  SMS_PROVIDER,
  USERS_REPOSITORY,
  type AuthSessionsRepository,
  type SmsProviderPort,
  type UsersRepository,
} from '@/modules/auth/index.js'
import { createTestApp, seedActor, seedChain, type TestApp } from './__tests__/staff-accounts-test-app.js'
import { seedPharmacyInChain } from '../auth/__tests__/seed-pharmacy.js'

const CHAIN_A = randomUUID()
const CHAIN_B = randomUUID()
const PHONE_DIGITS = 9

// PhoneNumber.parse (use case, не Zod) требует E.164 ЦИФРЫ — randomUUID() hex содержит буквы a-f.
function randomPhone(): string {
  let digits = ''
  for (let i = 0; i < PHONE_DIGITS; i += 1) {
    digits += Math.floor(Math.random() * 10).toString()
  }
  return `+992${digits}`
}

interface CreateBody {
  readonly data: { readonly userId: string; readonly role: string; readonly temporaryOtpHint: boolean }
}
interface ListBody {
  readonly data: readonly { readonly id: string; readonly role: string; readonly chainId: string | null; readonly pharmacyId: string | null }[]
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

describe('admin.staff-accounts (DTJ-364, SRS-ADM-041/042)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    await seedChain(app, CHAIN_A)
    await seedChain(app, CHAIN_B)
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('A. pharmacy_admin создаёт pharmacist → видит его в scope=own → деактивирует', async () => {
    const admin = await seedActor(app, 'pharmacy_admin', CHAIN_A)
    const phone = randomPhone()
    const pharmacyId = await seedPharmacyInChain(app, CHAIN_A)

    const create = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ phone, fullName: 'Фармацевт А', role: 'pharmacist', pharmacyId, chainId: CHAIN_A })
    expect(create.status).toBe(201)
    const created = (create.body as CreateBody).data
    expect(created.temporaryOtpHint).toBe(false)

    const list = await request(httpServer)
      .get('/api/v1/staff-accounts?scope=own')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(list.status).toBe(200)
    const items = (list.body as ListBody).data
    expect(items.some((i) => i.id === created.userId && i.role === 'pharmacist' && i.pharmacyId === pharmacyId)).toBe(true)

    const deactivate = await request(httpServer)
      .patch(`/api/v1/staff-accounts/${created.userId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ isActive: false })
    expect(deactivate.status).toBe(200)
  })

  it('B. pharmacy_admin (chain A) НЕ видит сотрудника сети B в scope=own', async () => {
    const adminA = await seedActor(app, 'pharmacy_admin', CHAIN_A)
    const adminB = await seedActor(app, 'pharmacy_admin', CHAIN_B)
    const phoneB = randomPhone()
    const createB = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${adminB.accessToken}`)
      .send({ phone: phoneB, fullName: 'Чужой сотрудник', role: 'pharmacist', pharmacyId: await seedPharmacyInChain(app, CHAIN_B), chainId: CHAIN_B })
    expect(createB.status).toBe(201)
    const createdB = (createB.body as CreateBody).data

    const listA = await request(httpServer)
      .get('/api/v1/staff-accounts?scope=own')
      .set('Authorization', `Bearer ${adminA.accessToken}`)
    const itemsA = (listA.body as ListBody).data
    expect(itemsA.some((i) => i.id === createdB.userId)).toBe(false)
  })

  it('C. pharmacy_admin (chain A) деактивирует сотрудника ЧУЖОЙ сети (chain B) → 403 CROSS_TENANT_ACCESS_DENIED', async () => {
    const adminA = await seedActor(app, 'pharmacy_admin', CHAIN_A)
    const adminB = await seedActor(app, 'pharmacy_admin', CHAIN_B)
    const phoneB = randomPhone()
    const createB = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${adminB.accessToken}`)
      .send({ phone: phoneB, fullName: 'Чужой сотрудник', role: 'pharmacist', pharmacyId: await seedPharmacyInChain(app, CHAIN_B), chainId: CHAIN_B })
    const createdB = (createB.body as CreateBody).data

    const deactivate = await request(httpServer)
      .patch(`/api/v1/staff-accounts/${createdB.userId}`)
      .set('Authorization', `Bearer ${adminA.accessToken}`)
      .send({ isActive: false })
    expect(deactivate.status).toBe(403)
    expect((deactivate.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })

  it('C2. pharmacy_admin (chain A) создаёт сотрудника в аптеке ЧУЖОЙ сети → 403 CROSS_TENANT_ACCESS_DENIED, сотрудник не создан', async () => {
    const adminA = await seedActor(app, 'pharmacy_admin', CHAIN_A)
    const foreignPharmacyId = await seedPharmacyInChain(app, CHAIN_B)
    const phone = randomPhone()

    const create = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${adminA.accessToken}`)
      .send({ phone, fullName: 'Внедрённый сотрудник', role: 'pharmacist', pharmacyId: foreignPharmacyId, chainId: CHAIN_A })
    expect(create.status).toBe(403)
    expect((create.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')

    const users = app.get<UsersRepository>(USERS_REPOSITORY)
    const stored = await users.list({ filter: { chainId: CHAIN_A, phoneLike: phone }, limit: 1, cursor: null })
    expect(stored.items).toEqual([])
  })

  it('D. роль без прав (pharmacist) → 403 INSUFFICIENT_ROLE (RolesGuard, ГРУБАЯ проверка ДО policy)', async () => {
    const pharmacist = await seedActor(app, 'pharmacist', CHAIN_A)

    const list = await request(httpServer)
      .get('/api/v1/staff-accounts?scope=own')
      .set('Authorization', `Bearer ${pharmacist.accessToken}`)
    expect(list.status).toBe(403)
    expect((list.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('E. pharmacy_admin создаёт courier → provision-courier создаёт delivery.couriers (chainId заполнен, БЕЗ pharmacyId)', async () => {
    const admin = await seedActor(app, 'pharmacy_admin', CHAIN_A)
    const phone = randomPhone()

    const create = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ phone, fullName: 'Курьер А', role: 'courier', chainId: CHAIN_A })
    expect(create.status).toBe(201)
    const created = (create.body as CreateBody).data

    const provision = await request(httpServer)
      .post(`/api/v1/staff-accounts/${created.userId}/provision-courier`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({})
    expect(provision.status).toBe(200)
    const courier = (provision.body as { readonly data: { readonly chainId: string | null; readonly userId: string } }).data
    expect(courier.chainId).toBe(CHAIN_A)
    expect(courier.userId).toBe(created.userId)

    const list = await request(httpServer)
      .get('/api/v1/staff-accounts?scope=own')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    const items = (list.body as ListBody).data
    const courierRow = items.find((i) => i.id === created.userId)
    expect(courierRow?.pharmacyId ?? null).toBeNull()
  })

  it('F. provision-courier для чужой сети → 403 CROSS_TENANT_ACCESS_DENIED', async () => {
    const adminA = await seedActor(app, 'pharmacy_admin', CHAIN_A)
    const adminB = await seedActor(app, 'pharmacy_admin', CHAIN_B)
    const phoneB = randomPhone()
    const createB = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${adminB.accessToken}`)
      .send({ phone: phoneB, fullName: 'Курьер B', role: 'courier', chainId: CHAIN_B })
    const createdB = (createB.body as CreateBody).data

    const provision = await request(httpServer)
      .post(`/api/v1/staff-accounts/${createdB.userId}/provision-courier`)
      .set('Authorization', `Bearer ${adminA.accessToken}`)
      .send({})
    expect(provision.status).toBe(403)
    expect((provision.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })

  it('G. деактивация отзывает активные сессии сотрудника, БЕЗ удаления его записи (только isActive=false)', async () => {
    const admin = await seedActor(app, 'pharmacy_admin', CHAIN_A)
    const phone = randomPhone()
    const create = await request(httpServer)
      .post('/api/v1/staff-accounts')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ phone, fullName: 'Фармацевт с сессией', role: 'pharmacist', pharmacyId: await seedPharmacyInChain(app, CHAIN_A), chainId: CHAIN_A })
    const created = (create.body as CreateBody).data

    const sms = app.get<unknown>(SMS_PROVIDER) as SmsProviderPort & { peekLast: () => { code: string } | null }
    const otpReq = await request(httpServer).post('/api/v1/auth/otp/request').send({ phone })
    const otpRequestId = (otpReq.body as { readonly data: { readonly otpRequestId: string } }).data.otpRequestId
    const code = sms.peekLast()?.code
    await request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code })

    const authSessions = app.get<AuthSessionsRepository>(AUTH_SESSIONS_REPOSITORY)
    expect((await authSessions.findActiveByUserId(created.userId, new Date())).length).toBeGreaterThan(0)

    await request(httpServer)
      .patch(`/api/v1/staff-accounts/${created.userId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ isActive: false })

    expect(await authSessions.findActiveByUserId(created.userId, new Date())).toEqual([])
    const list = await request(httpServer)
      .get('/api/v1/staff-accounts?scope=own')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    const row = (list.body as ListBody).data.find((i) => i.id === created.userId)
    expect(row).toBeDefined() // запись НЕ удалена, деактивация — только флаг
  })
})
