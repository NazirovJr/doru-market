/**
 * `refresh-reuse-detection.spec.ts` (EP-01, DTJ-029, SRS-API-027) — сквозной
 * тест защиты refresh-rotation от кражи токенов (reuse detection).
 *
 * Сценарий (из DTJ-029 «Что сделать» п.2):
 *   1. Полный цикл логина: request-otp → verify (получаем `refreshToken_1`).
 *   2. 2 легитимные ротации:
 *      - POST /auth/refresh с `refreshToken_1` → новый `accessToken_2` +
 *        `refreshToken_2`.
 *      - POST /auth/refresh с `refreshToken_2` → новый `accessToken_3` +
 *        `refreshToken_3`.
 *   3. Атакующий предъявляет ПЕРВЫЙ (`refreshToken_1`, устаревший) токен →
 *      401 `REFRESH_TOKEN_REUSE_DETECTED` (SRS-API-027).
 *   4. После reuse-detection ВСЯ `family_id` отзывается. Третий (последний
 *      легитимный) `refreshToken_3` ТОЖЕ становится невалиден при попытке
 *      использовать — `401 REFRESH_TOKEN_INVALID` (или `..._REUSE_DETECTED`,
 *      если ещё один атакующий с другим токеном из family; здесь — `INVALID`).
 *
 * Архитектурная гарантия (DTJ-025): в `uow.run(...)` revokeAllByFamilyId
 * ВСЕХ активных `auth_sessions` с тем же `family_id` и установка
 * `revoke_reason='reuse_detected'`. После этого ни один refresh-token из
 * family не валиден.
 */
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const PHONE = '+992917123456'

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
interface RefreshBody {
  readonly data: { readonly accessToken: string; readonly refreshToken: string }
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

describe('auth.refresh-reuse-detection (DTJ-029, SRS-API-027)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let sms: SmsProviderPort & { peekLast: () => { code: string } | null }

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    sms = app.get<unknown>(SMS_PROVIDER) as SmsProviderPort & {
      peekLast: () => { code: string } | null
    }
  })

  afterEach(async () => {
    await ctx.close()
  })

  /**
   * Хелпер: полный login-flow → возвращает `{ accessToken, refreshToken, userId }`.
   */
  async function login(): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
    const req = await request(httpServer)
      .post('/api/v1/auth/otp/request')
      .send({ phone: PHONE })
      .expect(202)
    const otpRequestId = (req.body as RequestOtpBody).data.otpRequestId
    const code = sms.peekLast()?.code
    if (code === undefined) throw new Error('mock SMS did not capture code')
    const verify = await request(httpServer)
      .post('/api/v1/auth/otp/verify')
      .send({ otpRequestId, code })
      .expect(200)
    const v = (verify.body as VerifyOtpBody).data
    return { accessToken: v.accessToken, refreshToken: v.refreshToken, userId: v.user.id }
  }

  async function refresh(oldRefresh: string): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await request(httpServer)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
    return {
      accessToken: (response.body as RefreshBody).data?.accessToken ?? '',
      refreshToken: (response.body as RefreshBody).data?.refreshToken ?? '',
    }
  }

  it('1. login → 2 rotate → reuse первого токена → 401 REFRESH_TOKEN_REUSE_DETECTED + revoke family', async () => {
    const initial = await login()
    // 1-я ротация: refreshToken_1 → refreshToken_2
    const r2 = await refresh(initial.refreshToken)
    expect(r2.refreshToken).not.toBe(initial.refreshToken)
    // 2-я ротация: refreshToken_2 → refreshToken_3
    const r3 = await refresh(r2.refreshToken)
    expect(r3.refreshToken).not.toBe(r2.refreshToken)

    // Атакующий предъявляет refreshToken_1 (самый старый, уже rotated).
    const reuseResp = await request(httpServer)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: initial.refreshToken })
    expect(reuseResp.status).toBe(401)
    const body = reuseResp.body as ErrorBody
    expect(body.error.code).toBe('REFRESH_TOKEN_REUSE_DETECTED')

    // После reuse-detection ВСЯ family отозвана. Третий (последний легитимный)
    // refreshToken_3 ТОЖЕ не работает — должен дать 401 (INVALID, потому что
    // revoked_at IS NOT NULL).
    const r3InvalidResp = await request(httpServer)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r3.refreshToken })
    expect(r3InvalidResp.status).toBe(401)
    const r3Body = r3InvalidResp.body as ErrorBody
    expect(['REFRESH_TOKEN_INVALID', 'REFRESH_TOKEN_REUSE_DETECTED']).toContain(r3Body.error.code)
  })

  it('2. легитимный цикл: 3 ротации подряд без reuse → каждая успешна', async () => {
    const initial = await login()
    const r2 = await refresh(initial.refreshToken)
    const r3 = await refresh(r2.refreshToken)
    // r3 всё ещё валиден (нет reuse).
    const r4 = await refresh(r3.refreshToken)
    expect(r4.accessToken).toBeTruthy()
    expect(r4.refreshToken).not.toBe(r3.refreshToken)
  })

  it('3. невалидный refresh token (рандомная строка) → 401 REFRESH_TOKEN_INVALID', async () => {
    const resp = await request(httpServer)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'totally-bogus-token' })
    expect(resp.status).toBe(401)
    const body = resp.body as ErrorBody
    expect(body.error.code).toBe('REFRESH_TOKEN_INVALID')
  })
})
