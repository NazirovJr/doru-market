/**
 * Unit-тесты `DcNextWebhookVerifierAdapter` (EP-10, DTJ-239) — зеркало
 * `alif-mobi-webhook-verifier.adapter.spec.ts` (см. его JSDoc).
 */
import { createHmac } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'
import { InvalidWebhookSignatureError } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { DcNextWebhookVerifierAdapter, DC_NEXT_SIGNATURE_HEADER } from './dc-next-webhook-verifier.adapter.js'

const SECRET = 'test-dc-next-webhook-secret'

function makeAdapter(secret: string | undefined): DcNextWebhookVerifierAdapter {
  const env: Partial<EnvConfig> = { DC_NEXT_WEBHOOK_SECRET: secret }
  const configService = {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>
  return new DcNextWebhookVerifierAdapter(new AppConfigService(configService))
}

function sign(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

function buildBody(overrides: Partial<Record<string, unknown>> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event_id: 'evt-dc-1',
      invoice_id: 'dc_bill_abc',
      status: 'DONE',
      amount: '20000',
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }),
  )
}

describe('DcNextWebhookVerifierAdapter (DTJ-239)', () => {
  it('валидная подпись → Ok(VerifiedWebhookPayload), DONE → payment_confirmed', () => {
    const adapter = makeAdapter(SECRET)
    const body = buildBody()
    const signature = sign(SECRET, body)

    const result = adapter.verify(body, { [DC_NEXT_SIGNATURE_HEADER]: signature })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bankEventId).toBe('evt-dc-1')
    expect(result.value.providerRef).toBe('dc_bill_abc')
    expect(result.value.type).toBe('payment_confirmed')
    expect(result.value.amountDiram).toBe(20_000n)
  })

  it('невалидная подпись → Err(InvalidWebhookSignatureError)', () => {
    const adapter = makeAdapter(SECRET)
    const body = buildBody()
    const wrongSignature = sign('wrong-secret', body)
    const result = adapter.verify(body, { [DC_NEXT_SIGNATURE_HEADER]: wrongSignature })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(InvalidWebhookSignatureError)
  })

  it('DC_NEXT_WEBHOOK_SECRET не настроен → Err, не бросает', () => {
    const adapter = makeAdapter(undefined)
    const body = buildBody()
    const signature = sign(SECRET, body)
    const result = adapter.verify(body, { [DC_NEXT_SIGNATURE_HEADER]: signature })
    expect(result.ok).toBe(false)
  })

  it('SRS-PAY-020: подпись проверяется ДО парсинга', () => {
    const adapter = makeAdapter(SECRET)
    const malformedBody = Buffer.from('not json at all')
    const signature = sign(SECRET, malformedBody)
    expect(() => adapter.verify(malformedBody, { [DC_NEXT_SIGNATURE_HEADER]: signature })).toThrow()
  })
})
