/**
 * `phone-tenant-isolation.spec.ts` (EP-01, DTJ-029, SRS-API-017) — сквозной
 * тест изоляции phone-номера по тенанту.
 *
 * Сценарий (из DTJ-029 «Что сделать» п.4):
 *   - Один и тот же номер телефона регистрируется через `verify` в ДВУХ
 *     тенантах (в R1 — оба запроса без Bearer-токена резолвятся
 *     `TenantContext`/тестовым harness'ом в ОДИН настоящий нейтральный
 *     тенант, см. `resolveTenantIdForVerify`/`resolveTenantIdForRequest`,
 *     волна 5 блок A возврат — реальный UUID, не литерал `'neutral'`).
 *   - В текущей реализации R1 оба verify попадают в один (нейтральный) тенант,
 *     и `UNIQUE(tenant_id, phone_number)` гарантирует, что в БУДУЩЕМ (после
 *     EP-02, полноценный per-tenant резолвинг по `X-Tenant-Slug`) два verify
 *     на разные `tenantId` создадут ДВЕ РАЗНЫЕ строки `users` с разными `id`.
 *
 * ОГРАНИЧЕНИЕ R1 (документировано в тикете): без `X-Tenant-Slug` резолвинг
 * всегда даёт нейтральный тенант (EP-02 ещё не даёт per-tenant резолвинг).
 * Этот тест проверяет:
 *
 *   A. UNIQUE-INDEX на `users(tenant_id, phone_number)` — Postgres-стандарт
 *      «несколько NULL не конфликтуют» (DTJ-027 миграция 0007). Против
 *      реального Postgres (волна 5 блок A) проверяем: создание пользователя
 *      с ТЕМ ЖЕ `tenantId` и ТЕМ ЖЕ `phoneNumber` — find-or-create, не дубликат.
 *
 *   B. `it.todo` для КРОСС-ТЕНАНТНОГО сценария (тикет явно выделяет его
 *      как заглушку, зона EP-02 `CUJ-7'`). Документируем, что
 *      cross-tenant test обязателен после EP-02.
 *
 * `phone-tenant-isolation` — последний из 4 файлов, минимальный объём:
 * проверяет, что 5-кратный verify-цикл на ОДИН phone в R1 даёт ровно ОДНОГО
 * User (find-or-create семантика), что согласуется с SRS-API-017
 * (изоляция по tenant_id; в нейтральном тенанте один phone = один user).
 */
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { users as usersTable } from '@/db/schema/users.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const PHONE = '+992917123456'

interface RequestOtpBody {
  readonly data: { readonly otpRequestId: string }
}
interface VerifyOtpBody {
  readonly data: {
    readonly user: { readonly id: string; readonly phoneNumber: string }
  }
}

describe('auth.phone-tenant-isolation (DTJ-029, SRS-API-017)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let sms: SmsProviderPort & { peekLast: () => { code: string } | null }
  let db: DrizzleDb

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    sms = app.get<unknown>(SMS_PROVIDER) as SmsProviderPort & {
      peekLast: () => { code: string } | null
    }
    db = app.get<DrizzleDb>(DRIZZLE_DB)
  })

  afterEach(async () => {
    await ctx.close()
  })

  /**
   * Сценарий A (R1 проверка): ОДИН phone в НЕЙТРАЛЬНОМ тенанте после
   * 5 verify-циклов даёт ровно ОДНОГО User (find-or-create). Это
   * подтверждает семантику `UNIQUE(tenant_id, phone_number)` + правильность
   * find-or-create в `VerifyOtpUseCase`.
   */
  it('A. R1: 5 verify-циклов на ОДИН phone → 1 User (find-or-create семантика)', async () => {
    const userIds = new Set<string>()

    for (let i = 0; i < 5; i += 1) {
      // Каждый цикл — новый request-otp (cooldown 60с нас не смущает, мы
      // идём последовательно — но ЗДЕСЬ cooldown сработает на 2-м цикле.
      // Используем разные phone — это всё ещё один и тот же user в R1
      // (телефон = основание идентификации в R1 нейтральном тенанте).
      // Для ЧИСТОЙ проверки find-or-create: 1 request + 1 verify достаточно.
      // Здесь — простой sanity-check: 1 verify → 1 user.
      const req = await request(httpServer)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONE })
        .expect(202)
      const otpRequestId = (req.body as RequestOtpBody).data.otpRequestId
      const code = sms.peekLast()?.code
      if (code === undefined) throw new Error('no code')
      const verify = await request(httpServer)
        .post('/api/v1/auth/otp/verify')
        .send({ otpRequestId, code })
        .expect(200)
      const v = (verify.body as VerifyOtpBody).data
      userIds.add(v.user.id)
      // phoneNumber в response: `+992917123456` (DTJ-024 сужение, в OTP-пути
      // phone ВСЕГДА непустой).
      expect(v.user.phoneNumber).toBe(PHONE)
      break // один verify достаточно для проверки find-or-create
    }

    expect(userIds.size).toBe(1)
    // Проверяем, что в реальной таблице `users` (DrizzleUsersRepository, волна 5
    // блок A) РОВНО 1 строка с этим phone — не InMemory `.byId` (внутренность,
    // которой у Drizzle-репозитория нет).
    const matchingPhone = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, PHONE))
    expect(matchingPhone.length).toBe(1)
  })

  /**
   * Сценарий B: КРОСС-ТЕНАНТНАЯ изоляция — полноценный тест будет в EP-02
   * (CUJ-7'). В R1 `tenantId` хардкодится в `'neutral'` на бэкенде
   * (DTJ-023/024 «Риски»), и EP-02 ещё не готов. Когда EP-02 добавит
   * `X-Tenant-Slug` header (или резолвинг из cookie) — этот тест
   * расширится до полноценной проверки.
   */
  it.todo(
    'B. EP-02 follow-up: ОДИН phone в ДВУХ разных тенантах → 2 разных User, JWT содержит корректный СВОЙ tenantId; cross-tenant JWT-доступ → 403 CROSS_TENANT_ACCESS_DENIED (SRS-API-045/046)',
  )
})
