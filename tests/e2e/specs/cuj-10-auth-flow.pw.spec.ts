// Цепочка шагов (expired → refresh → reuse → новый токен семьи) — одна сессия, поэтому serial.
import { test, expect } from '@playwright/test'
import { SEED_USERS, E2E_FRESH_PHONE_PREFIX } from '@dorutj/testing-kit'
import { loginViaApi, type ApiSession } from '../helpers/login-via-api.js'
import { signExpiredAccessToken } from '../helpers/cuj10-sign-expired-token.js'
import { refreshTokens, getOwnSessions, getAuditLog } from '../helpers/cuj10-auth-flow-api.js'

function freshPhone(suffix: string): string {
  return `${E2E_FRESH_PHONE_PREFIX}21${suffix}`
}

const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const TOKEN_EXPIRED = 'TOKEN_EXPIRED'
const REFRESH_TOKEN_REUSE_DETECTED = 'REFRESH_TOKEN_REUSE_DETECTED'
const INSUFFICIENT_ROLE = 'INSUFFICIENT_ROLE'

test.describe('CUJ-10: поток авторизации (DTJ-421, SRS-NFR-074)', () => {
  test.skip(process.env.E2E_BASE_URL === undefined, 'запускается только с E2E_BASE_URL=<адрес поднятого apps/api>')

  test.describe.serial('токен-цепочка: expired → refresh → reuse-detect → новый токен семьи (SRS-NFR-074 шаги 1-7)', () => {
    let session: ApiSession | undefined
    let rotatedAccessToken: string | undefined

    test('expired access token returns 401 TOKEN_EXPIRED', async () => {
      const privateKey = process.env.E2E_JWT_PRIVATE_KEY
      test.skip(privateKey === undefined, 'запускается только с E2E_JWT_PRIVATE_KEY=<PEM приватного ключа стенда, см. отчёт сдачи>')

      session = await loginViaApi(freshPhone('101'))
      const expiredToken = signExpiredAccessToken(
        { sub: session.user.id, role: session.user.role, tenantId: session.user.tenantId },
        privateKey!,
      )
      const response = await getOwnSessions(expiredToken)
      expect(response.status).toBe(HTTP_UNAUTHORIZED)
      expect(response.body.error?.code).toBe(TOKEN_EXPIRED)
    })

    test('refresh rotates token pair, marks old refresh as rotated', async () => {
      test.skip(session === undefined, 'зависит от предыдущего шага серии (вход по OTP)')
      const response = await refreshTokens(session!.refreshToken)
      expect(response.status).toBe(HTTP_OK)
      expect(response.body.data?.accessToken).toBeDefined()
      expect(response.body.data?.refreshToken).toBeDefined()
      expect(response.body.data?.refreshToken).not.toBe(session!.refreshToken)
      rotatedAccessToken = response.body.data?.accessToken
    })

    test('reused old refresh token triggers REFRESH_TOKEN_REUSE_DETECTED and revokes entire family', async () => {
      test.skip(session === undefined, 'зависит от предыдущего шага серии (refresh)')
      const response = await refreshTokens(session!.refreshToken)
      expect(response.status).toBe(HTTP_UNAUTHORIZED)
      expect(response.body.error?.code).toBe(REFRESH_TOKEN_REUSE_DETECTED)

      // Проверка через API, не только код ответа: findActiveByUserId отдаёт строго
      // revoked_at IS NULL — пустой список подтверждает отзыв всей семьи.
      const sessionsResponse = await getOwnSessions(session!.accessToken)
      expect(sessionsResponse.status).toBe(HTTP_OK)
      expect(sessionsResponse.body.data ?? []).toHaveLength(0)
    })

    test('new access token from rotated family also rejected after reuse detected', async () => {
      test.skip(rotatedAccessToken === undefined, 'зависит от предыдущего шага серии (rotate)')
      // Ожидаемо красное: AuthGuard проверяет только подпись/exp, не revoked_at сессии.
      const response = await getOwnSessions(rotatedAccessToken!)
      expect(response.status).toBe(HTTP_UNAUTHORIZED)
    })
  })

  test('customer role cannot access super_admin-only audit-log route', async () => {
    const customer = await loginViaApi(SEED_USERS.customer1.phone)
    const response = await getAuditLog(customer.accessToken)
    expect(response.status).toBe(HTTP_FORBIDDEN)
    expect(response.body.error?.code).toBe(INSUFFICIENT_ROLE)
  })
})
