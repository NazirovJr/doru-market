/**
 * Unit-тесты `AlifMobiWebhookVerifierAdapter` (EP-10, DTJ-239, SRS-PAY-006). Зеркало
 * `mock-bank-webhook-verifier.adapter.spec.ts` (DTJ-238) — валидная/невалидная подпись,
 * отсутствующий секрет/заголовок, порядок «подпись → парсинг» (SRS-PAY-020), но base64
 * (research 03 §2.7 ASSUMPTION), не hex.
 */
import { createHmac } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'
import { InvalidWebhookSignatureError } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { AlifMobiWebhookVerifierAdapter, ALIF_MOBI_SIGNATURE_HEADER } from './alif-mobi-webhook-verifier.adapter.js'

const SECRET = 'test-alif-mobi-webhook-secret'

function makeAdapter(secret: string | undefined): AlifMobiWebhookVerifierAdapter {
  const env: Partial<EnvConfig> = { ALIF_MOBI_WEBHOOK_SECRET: secret }
  const configService = {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>
  return new AlifMobiWebhookVerifierAdapter(new AppConfigService(configService))
}

function sign(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

function buildBody(overrides: Partial<Record<string, unknown>> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event_id: 'evt-alif-1',
      invoice_id: 'alif_bill_abc',
      status: 'DONE',
      amount: '10000',
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }),
  )
}

describe('AlifMobiWebhookVerifierAdapter (DTJ-239)', () => {
  it('валидная подпись → Ok(VerifiedWebhookPayload), DONE → payment_confirmed', () => {
    const adapter = makeAdapter(SECRET)
    const body = buildBody()
    const signature = sign(SECRET, body)

    const result = adapter.verify(body, { [ALIF_MOBI_SIGNATURE_HEADER]: signature })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bankEventId).toBe('evt-alif-1')
    expect(result.value.providerRef).toBe('alif_bill_abc')
    expect(result.value.type).toBe('payment_confirmed')
    expect(result.value.amountDiram).toBe(10_000n)
    expect(result.value.occurredAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  it.each([
    ['FAILED', 'payment_failed'],
    ['REFUNDED', 'refund_confirmed'],
    ['REFUND_FAILED', 'refund_failed'],
  ] as const)('status=%s → type=%s', (status, expectedType) => {
    const adapter = makeAdapter(SECRET)
    const body = buildBody({ status })
    const signature = sign(SECRET, body)

    const result = adapter.verify(body, { [ALIF_MOBI_SIGNATURE_HEADER]: signature })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.type).toBe(expectedType)
  })

  it('невалидная подпись (чужой секрет) → Err(InvalidWebhookSignatureError)', () => {
    const adapter = makeAdapter(SECRET)
    const body = buildBody()
    const wrongSignature = sign('wrong-secret', body)

    const result = adapter.verify(body, { [ALIF_MOBI_SIGNATURE_HEADER]: wrongSignature })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(InvalidWebhookSignatureError)
  })

  it('отсутствует заголовок подписи → Err', () => {
    const adapter = makeAdapter(SECRET)
    const result = adapter.verify(buildBody(), {})
    expect(result.ok).toBe(false)
  })

  it('ALIF_MOBI_WEBHOOK_SECRET не настроен → Err, не бросает', () => {
    const adapter = makeAdapter(undefined)
    const body = buildBody()
    const signature = sign(SECRET, body)
    const result = adapter.verify(body, { [ALIF_MOBI_SIGNATURE_HEADER]: signature })
    expect(result.ok).toBe(false)
  })

  it('SRS-PAY-020: подпись проверяется ДО парсинга — валидная подпись невалидного JSON бросает', () => {
    const adapter = makeAdapter(SECRET)
    const malformedBody = Buffer.from('not json at all')
    const signature = sign(SECRET, malformedBody)
    expect(() => adapter.verify(malformedBody, { [ALIF_MOBI_SIGNATURE_HEADER]: signature })).toThrow()
  })
})
