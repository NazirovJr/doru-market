/**
 * `otp-verify-race.spec.ts` (EP-01, DTJ-029, SRS-API-071) — сквозной тест
 * защиты от race condition двух одновременных verify-запросов с одним
 * `otpRequestId` и одним валидным кодом.
 *
 * Сценарий (из DTJ-029 «Что сделать» п.3):
 *   - `POST /auth/otp/request` → 202 + otpRequestId.
 *   - `Promise.all([verify(code), verify(code)])` — два конкурентных запроса.
 *   - Проверка:
 *     1. Ровно один получает `200` с валидной парой токенов.
 *     2. Второй получает `400 OTP_MISMATCH` (`alreadyConsumed` в `VerifyOtp`).
 *     3. Создана РОВНО одна `auth_sessions`-запись, не две.
 *
 * Реализация: `VerifyOtpUseCase` использует `SELECT ... FOR UPDATE` через
 * `uow.run` (DTJ-024), что даёт строгую сериализацию двух транзакций на
 * уровне `otp_codes.consumed_at` — реальный Postgres row-lock (волна 5 блок
 * A, `DrizzleUnitOfWorkAdapter`/`db.transaction`), не InMemory-эмуляция:
 * второй verify блокируется на `FOR UPDATE`, видит `consumedAt !== null`
 * после разблокировки и возвращает `OTP_MISMATCH`.
 *
 * Проверка «ровно одна `auth_sessions`»: прямой `COUNT(*)` через `DRIZZLE_DB`
 * (реальная таблица, не `InMemoryAuthSessionsRepository.byId.size` —
 * `AUTH_SESSIONS_REPOSITORY` теперь резолвит `DrizzleAuthSessionsRepository`,
 * без публичного `.byId`).
 */
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { authSessions } from '@/db/schema/auth-sessions.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const PHONE = '+992917123456'

interface RequestOtpBody {
  readonly data: { readonly otpRequestId: string }
}
interface VerifyOtpBody {
  readonly data: { readonly accessToken: string; readonly refreshToken: string }
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

describe('auth.otp-verify-race (DTJ-029, SRS-API-071)', () => {
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

  /** `COUNT(*)` реальных строк `auth_sessions` — таблица чистая на старте каждого теста (`resetAuthState`). */
  async function countAuthSessions(): Promise<number> {
    const rows = await db.select().from(authSessions)
    return rows.length
  }

  afterEach(async () => {
    await ctx.close()
  })

  it('1. Promise.all двух verify с одним кодом → ровно 1 успех + 1 OTP_MISMATCH', async () => {
    const req = await request(httpServer)
      .post('/api/v1/auth/otp/request')
      .send({ phone: PHONE })
      .expect(202)
    const otpRequestId = (req.body as RequestOtpBody).data.otpRequestId
    const code = sms.peekLast()?.code
    expect(code).toBeDefined()

    // Один и тот же код отправляется двумя конкурентными verify.
    const [r1, r2] = await Promise.all([
      request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code }),
      request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code }),
    ])

    const statuses = [r1.status, r2.status].sort()
    // Один 200, один 400.
    expect(statuses).toEqual([200, 400])

    const errored = r1.status === 400 ? r1 : r2
    const errorBody = errored.body as ErrorBody
    expect(errorBody.error.code).toBe('OTP_MISMATCH')

    const successed = r1.status === 200 ? r1 : r2
    const successBody = successed.body as VerifyOtpBody
    expect(successBody.data.accessToken).toBeTruthy()
    expect(successBody.data.refreshToken).toBeTruthy()
  })

  it('2. после race создана РОВНО одна auth_sessions-запись', async () => {
    const req = await request(httpServer)
      .post('/api/v1/auth/otp/request')
      .send({ phone: PHONE })
      .expect(202)
    const otpRequestId = (req.body as RequestOtpBody).data.otpRequestId
    const code = sms.peekLast()?.code
    if (code === undefined) throw new Error('no code')

    const before = await countAuthSessions()
    await Promise.all([
      request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code }),
      request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code }),
    ])
    const after = await countAuthSessions()
    // Ровно +1 сессия, не +2.
    expect(after - before).toBe(1)
  })

  it('3. 10 повторных прогонов race-сценария: каждый раз ровно 1 успех + 1 запись', async () => {
    // Приёмка №3 DTJ-029: «КАЖДЫЙ раз ровно одна `auth_sessions`-запись
    // создаётся — не "обычно одна, иногда две"». 10 итераций.
    for (let i = 0; i < 10; i += 1) {
      // Новый номер на каждой итерации, чтобы cooldown не сработал.
      const phone = `+99291712${String(3400 + i).padStart(4, '0')}`
      const req = await request(httpServer)
        .post('/api/v1/auth/otp/request')
        .send({ phone })
      expect(req.status).toBe(202)
      const otpRequestId = (req.body as RequestOtpBody).data.otpRequestId
      // Получаем код — MockSms.peekLast возвращает ПОСЛЕДНЮЮ отправку,
      // что в нашем случае соответствует только что отправленному.
      const code = sms.peekLast()?.code
      if (code === undefined) throw new Error('no code')

      const before = await countAuthSessions()
      const [r1, r2] = await Promise.all([
        request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code }),
        request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code }),
      ])
      const statuses = [r1.status, r2.status].sort()
      expect(statuses, `iter ${String(i + 1)}/10`).toEqual([200, 400])
      const after = await countAuthSessions()
      expect(after - before, `iter ${String(i + 1)}/10: sessions created`).toBe(1)
    }
  })
})
