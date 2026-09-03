/**
 * Unit-тесты `MockBankAutoPayJob.process()` (EP-10, DTJ-238) — `fetch` замокан глобально,
 * без реального BullMQ/Redis/HTTP (см. `mock-bank-auto-pay.job.integration.spec.ts` для
 * реального прогона очереди + локального HTTP-сервера).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { MockBankAutoPayJob } from './mock-bank-auto-pay.job.js'
import type { MockBankAutoPayJobData } from './mock-bank-auto-pay.types.js'

function fakeJob(data: MockBankAutoPayJobData): Job<MockBankAutoPayJobData> {
  return { id: 'job-1', data } as unknown as Job<MockBankAutoPayJobData>
}

const JOB_DATA: MockBankAutoPayJobData = {
  bankEventId: 'evt-1',
  providerRef: 'mock_inv_abc',
  type: 'payment_confirmed',
  amountDiram: '10000',
}

describe('MockBankAutoPayJob.process (DTJ-238)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('MOCK_BANK_WEBHOOK_SECRET не настроен → бросает, не отправляет запрос (программная ошибка, не молчаливая деградация)', async () => {
    const job = new MockBankAutoPayJob()
    await expect(
      job.process(fakeJob(JOB_DATA), { apiInternalUrl: 'http://localhost:3000', webhookSecret: undefined }),
    ).rejects.toThrow(/MOCK_BANK_WEBHOOK_SECRET/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('POST /api/v1/payments/webhook с X-Payment-Provider: mock_bank и подписанным телом', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = fetchMock

    const job = new MockBankAutoPayJob()
    await job.process(fakeJob(JOB_DATA), { apiInternalUrl: 'http://localhost:3000', webhookSecret: 'test-secret' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('http://localhost:3000/api/v1/payments/webhook')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['x-payment-provider']).toBe('mock_bank')
    expect(headers['x-webhook-signature']).toBeDefined()
    expect(headers['x-webhook-signature']).toMatch(/^[0-9a-f]{64}$/)

    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.bankEventId).toBe('evt-1')
    expect(body.providerRef).toBe('mock_inv_abc')
    expect(body.type).toBe('payment_confirmed')
    expect(body.amountDiram).toBe('10000')
    expect(typeof body.occurredAt).toBe('string')
  })

  it('HTTP 404 (обработчик DTJ-243 ещё не задеплоен) — НЕ бросает, логирует и завершается успешно', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    const job = new MockBankAutoPayJob()

    await expect(
      job.process(fakeJob(JOB_DATA), { apiInternalUrl: 'http://localhost:3000', webhookSecret: 'test-secret' }),
    ).resolves.toBeUndefined()
  })

  it('другая ошибка HTTP (500) → бросает, чтобы BullMQ ретраил', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const job = new MockBankAutoPayJob()

    await expect(
      job.process(fakeJob(JOB_DATA), { apiInternalUrl: 'http://localhost:3000', webhookSecret: 'test-secret' }),
    ).rejects.toThrow(/HTTP 500/)
  })
})
