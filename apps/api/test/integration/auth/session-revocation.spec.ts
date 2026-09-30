// DTJ-443: access-токен отозванной сессии отклоняется сразу; реальные Postgres/Redis.
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const PHONE = '+992917123456'
const OTHER_PHONE = '+992917123457'
const ME_PATH = '/api/v1/auth/me'

interface Tokens {
  readonly accessToken: string
  readonly refreshToken: string
}
interface EnvelopeBody<T> {
  readonly data: T
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

describe('auth.session-revocation (DTJ-443, SRS-NFR-074)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let sms: SmsProviderPort & { peekLast: () => { code: string } | null }

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    sms = app.get<unknown>(SMS_PROVIDER) as SmsProviderPort & { peekLast: () => { code: string } | null }
  })

  afterEach(async () => {
    await ctx.close()
  })

  async function login(phone: string): Promise<Tokens> {
    const req = await request(httpServer).post('/api/v1/auth/otp/request').send({ phone }).expect(202)
    const otpRequestId = (req.body as EnvelopeBody<{ otpRequestId: string }>).data.otpRequestId
    const code = sms.peekLast()?.code
    const verify = await request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code }).expect(200)
    return (verify.body as EnvelopeBody<Tokens>).data
  }

  async function refresh(refreshToken: string): Promise<Tokens> {
    const response = await request(httpServer).post('/api/v1/auth/refresh').send({ refreshToken }).expect(200)
    return (response.body as EnvelopeBody<Tokens>).data
  }

  function me(accessToken: string): request.Test {
    return request(httpServer).get(ME_PATH).set('Authorization', `Bearer ${accessToken}`)
  }

  it('живая сессия принимается', async () => {
    const { accessToken } = await login(PHONE)

    expect((await me(accessToken)).status).toBe(200)
  })

  it('reuse refresh-токена отзывает семью: старые access-токены семьи → 401, включая последний легитимный', async () => {
    const first = await login(PHONE)
    const second = await refresh(first.refreshToken)
    const third = await refresh(second.refreshToken)
    expect((await me(third.accessToken)).status).toBe(200)

    await request(httpServer).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401)

    for (const token of [first.accessToken, second.accessToken, third.accessToken]) {
      const response = await me(token)
      expect(response.status).toBe(401)
      expect((response.body as ErrorBody).error.code).toBe('TOKEN_INVALID')
    }
  })

  it('logout-all: access-токен отклоняется сразу, токены другого пользователя работают', async () => {
    const mine = await login(PHONE)
    const other = await login(OTHER_PHONE)
    expect((await me(mine.accessToken)).status).toBe(200)

    await request(httpServer).post('/api/v1/auth/logout-all').set('Authorization', `Bearer ${mine.accessToken}`).expect(204)

    expect((await me(mine.accessToken)).status).toBe(401)
    expect((await me(other.accessToken)).status).toBe(200)
  })

  it('logout текущей сессии: её access-токен отклоняется', async () => {
    const tokens = await login(PHONE)
    expect((await me(tokens.accessToken)).status).toBe(200)

    await request(httpServer)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ refreshToken: tokens.refreshToken })
      .expect(204)

    expect((await me(tokens.accessToken)).status).toBe(401)
  })

  it('кэш: повторные запросы одной сессии не ходят в БД — один findById на промахе', async () => {
    const { accessToken } = await login(PHONE)
    const findById = vi.spyOn(app.get<AuthSessionsRepository>(AUTH_SESSIONS_REPOSITORY), 'findById')

    for (let i = 0; i < 3; i += 1) {
      expect((await me(accessToken)).status).toBe(200)
    }

    expect(findById).toHaveBeenCalledTimes(1)
  })
})
