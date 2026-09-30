// DTJ-064: OTP контактного телефона заявки сети идёт через OTP-механизм auth; заглушечный код «0000» не проходит.
import type { Server } from 'node:http'
import { randomInt } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/index.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyChains } from '@/db/schema/pharmacy-chains.js'
import { createTestApp, type TestApp } from './__tests__/chain-contact-otp-test-app.js'

const TIN_DIGITS = 12
const NATIONAL_DIGITS = 8
const MAX_WRONG_ATTEMPTS = 5

type PeekableSms = SmsProviderPort & { peekLast: () => { code: string } | null }

interface DataBody<T> {
  readonly data: T
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

function randomDigits(length: number): string {
  let digits = ''
  for (let i = 0; i < length; i += 1) {
    digits += String(randomInt(10))
  }
  return digits
}

describe('onboarding.pharmacy-chains contact OTP (DTJ-064)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let sms: PeekableSms

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    sms = app.get<unknown>(SMS_PROVIDER) as PeekableSms
  })

  afterEach(async () => {
    await ctx.close()
  })

  async function submitChain(): Promise<string> {
    const response = await request(httpServer)
      .post('/api/v1/pharmacy-chains')
      .send({
        legalEntityName: 'OTP Test LLC',
        tinInn: randomDigits(TIN_DIGITS),
        directorFullName: 'Director Test',
        contactPhone: `+9929${randomDigits(NATIONAL_DIGITS)}`,
        legalAddress: 'Dushanbe, test str. 1',
      })
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    return (response.body as DataBody<{ id: string }>).data.id
  }

  async function requestOtp(chainId: string): Promise<string> {
    const response = await request(httpServer).post(`/api/v1/pharmacy-chains/${chainId}/request-contact-phone-otp`).send({})
    expect(response.status).toBe(200)
    expect((response.body as DataBody<{ sent: boolean }>).data.sent).toBe(true)
    const code = sms.peekLast()?.code
    if (code === undefined) throw new Error('mock SMS did not capture code')
    return code
  }

  function verify(chainId: string, code: string): request.Test {
    return request(httpServer).post(`/api/v1/pharmacy-chains/${chainId}/verify-contact-phone`).send({ code })
  }

  async function isVerified(chainId: string): Promise<boolean> {
    const rows = await app
      .get<DrizzleDb>(DRIZZLE_DB)
      .select({ verified: pharmacyChains.contactPhoneVerified })
      .from(pharmacyChains)
      .where(eq(pharmacyChains.id, chainId))
    return rows[0]?.verified ?? false
  }

  it('A. код из SMS подтверждает контакт заявки', async () => {
    const chainId = await submitChain()
    const code = await requestOtp(chainId)

    const response = await verify(chainId, code)

    expect(response.status).toBe(200)
    expect((response.body as DataBody<{ verified: boolean }>).data.verified).toBe(true)
    expect(await isVerified(chainId)).toBe(true)
  })

  it('B. заглушечный код «0000» больше не проходит, контакт не подтверждён', async () => {
    const chainId = await submitChain()
    await requestOtp(chainId)

    const response = await verify(chainId, '0000')

    expect(response.status).toBe(400)
    expect((response.body as ErrorBody).error.code).toBe('OTP_MISMATCH')
    expect(await isVerified(chainId)).toBe(false)
  })

  it('C. без запроса кода любой код отклоняется', async () => {
    const chainId = await submitChain()

    const response = await verify(chainId, '123456')

    expect(response.status).toBe(400)
    expect((response.body as ErrorBody).error.code).toBe('OTP_MISMATCH')
    expect(await isVerified(chainId)).toBe(false)
  })

  it('D. код одной заявки не подтверждает другую', async () => {
    const chainA = await submitChain()
    const chainB = await submitChain()
    const codeA = await requestOtp(chainA)

    const response = await verify(chainB, codeA)

    expect(response.status).toBe(400)
    expect(await isVerified(chainB)).toBe(false)
    expect(await isVerified(chainA)).toBe(false)
  })

  it('E. одноразовость: потреблённый код повторно не работает', async () => {
    const chainId = await submitChain()
    const code = await requestOtp(chainId)
    expect((await verify(chainId, code)).status).toBe(200)

    const again = await verify(chainId, code)

    expect(again.status).toBe(400)
  })

  it('F. перебор: после 5 неверных попыток верный код блокируется 423 OTP_LOCKED', async () => {
    const chainId = await submitChain()
    const code = await requestOtp(chainId)
    for (let i = 0; i < MAX_WRONG_ATTEMPTS; i += 1) {
      expect((await verify(chainId, '000000')).status).toBe(400)
    }

    const locked = await verify(chainId, code)

    expect(locked.status).toBe(423)
    expect((locked.body as ErrorBody).error.code).toBe('OTP_LOCKED')
    expect(await isVerified(chainId)).toBe(false)
  })

  it('G. повторный запрос кода в пределах cooldown ограничивается общим лимитом auth (429)', async () => {
    const chainId = await submitChain()
    await requestOtp(chainId)

    const second = await request(httpServer).post(`/api/v1/pharmacy-chains/${chainId}/request-contact-phone-otp`).send({})

    expect(second.status).toBe(429)
    expect((second.body as ErrorBody).error.code).toBe('OTP_REQUEST_RATE_LIMITED')
  })
})
