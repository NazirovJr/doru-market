/**
 * Unit-тесты `MockBankWebhookVerifierAdapter` (EP-10, DTJ-238, SRS-PAY-005) — чистая
 * HMAC-логика, без сети/БД. Покрывает: валидную подпись, невалидную подпись, отсутствующий
 * секрет/заголовок, порядок «подпись → парсинг» (SRS-PAY-020).
 */
import { createHmac } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'
import { InvalidWebhookSignatureError } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { MockBankWebhookVerifierAdapter, WEBHOOK_SIGNATURE_HEADER } from './mock-bank-webhook-verifier.adapter.js'

const SECRET = 'test-mock-bank-webhook-secret'

function makeAdapter(secret: string | undefined): MockBankWebhookVerifierAdapter {
  const env: Partial<EnvConfig> = { MOCK_BANK_WEBHOOK_SECRET: secret }
  const configService = {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>
  return new MockBankWebhookVerifierAdapter(new AppConfigService(configService))
}

function sign(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function buildBody(overrides: Partial<Record<string, unknown>> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      bankEventId: 'evt-1',
      providerRef: 'mock_inv_abc',
      type: 'payment_confirmed',
      amountDiram: '10000',
      occurredAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }),
  )
}

describe('MockBankWebhookVerifierAdapter (DTJ-238)', () => {
  it('валидная подпись → Ok(VerifiedWebhookPayload) с корректной конвертацией типов', () => {
    const adapter = makeAdapter(SECRET)
    const body = buildBody()
    const signature = sign(SECRET, body)

    const result = adapter.verify(body, { [WEBHOOK_SIGNATURE_HEADER]: signature })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bankEventId).toBe('evt-1')
    expect(result.value.providerRef).toBe('mock_inv_abc')
    expect(result.value.type).toBe('payment_confirmed')
    expect(result.value.amountDiram).toBe(10_000n)
    expect(result.value.occurredAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  it('невалидная подпись (чужой секрет) → Err(InvalidWebhookSignatureError)', () => {
    const adapter = makeAdapter(SECRET)
    const body = buildBody()
    const wrongSignature = sign('wrong-secret', body)

    const result = adapter.verify(body, { [WEBHOOK_SIGNATURE_HEADER]: wrongSignature })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(InvalidWebhookSignatureError)
  })

  it('изменённое тело после подписи → Err(InvalidWebhookSignatureError) (целостность)', () => {
    const adapter = makeAdapter(SECRET)
    const originalBody = buildBody({ amountDiram: '10000' })
    const signature = sign(SECRET, originalBody)
    const tamperedBody = buildBody({ amountDiram: '999999' })

    const result = adapter.verify(tamperedBody, { [WEBHOOK_SIGNATURE_HEADER]: signature })

    expect(result.ok).toBe(false)
  })

  it('отсутствует заголовок подписи → Err(InvalidWebhookSignatureError)', () => {
    const adapter = makeAdapter(SECRET)
    const result = adapter.verify(buildBody(), {})
    expect(result.ok).toBe(false)
  })

  it('MOCK_BANK_WEBHOOK_SECRET не настроен → Err(InvalidWebhookSignatureError), не бросает', () => {
    const adapter = makeAdapter(undefined)
    const body = buildBody()
    const signature = sign(SECRET, body)

    const result = adapter.verify(body, { [WEBHOOK_SIGNATURE_HEADER]: signature })

    expect(result.ok).toBe(false)
  })

  it('невалидный hex в заголовке подписи → Err (не бросает)', () => {
    const adapter = makeAdapter(SECRET)
    const result = adapter.verify(buildBody(), { [WEBHOOK_SIGNATURE_HEADER]: 'not-hex-zz' })
    expect(result.ok).toBe(false)
  })

  it('SRS-PAY-020: подпись проверяется ДО парсинга — валидная подпись невалидного JSON бросает (программная ошибка, не подделка)', () => {
    const adapter = makeAdapter(SECRET)
    const malformedBody = Buffer.from('not json at all')
    const signature = sign(SECRET, malformedBody)

    expect(() => adapter.verify(malformedBody, { [WEBHOOK_SIGNATURE_HEADER]: signature })).toThrow()
  })
})
