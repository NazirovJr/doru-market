/**
 * Unit-тесты `PartialFulfillmentTimeoutJob.process()` (EP-12, DTJ-304) — `fetch` замокан
 * глобально, без реального BullMQ/Redis/HTTP (тот же приём, что `mock-bank-auto-pay.job.spec.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { PartialFulfillmentTimeoutJob } from './partial-fulfillment-timeout.job.js'
import type { PartialFulfillmentTimeoutJobData } from './partial-fulfillment-timeout.types.js'

function fakeJob(data: PartialFulfillmentTimeoutJobData): Job<PartialFulfillmentTimeoutJobData> {
  return { id: 'job-1', data } as unknown as Job<PartialFulfillmentTimeoutJobData>
}

const JOB_DATA: PartialFulfillmentTimeoutJobData = { requestId: 'req-1', tenantId: 'tenant-1' }

describe('PartialFulfillmentTimeoutJob.process (DTJ-304)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('INTERNAL_API_KEY не настроен → бросает, не отправляет запрос', async () => {
    const job = new PartialFulfillmentTimeoutJob()
    await expect(
      job.process(fakeJob(JOB_DATA), { apiInternalUrl: 'http://localhost:3000', internalApiKey: undefined }),
    ).rejects.toThrow(/INTERNAL_API_KEY/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('POST /api/v1/internal/orders/partial-fulfillment-requests/:id/resolve-timeout с x-internal-api-key и телом { tenantId }', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = fetchMock

    const job = new PartialFulfillmentTimeoutJob()
    await job.process(fakeJob(JOB_DATA), { apiInternalUrl: 'http://localhost:3000', internalApiKey: 'secret-key' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('http://localhost:3000/api/v1/internal/orders/partial-fulfillment-requests/req-1/resolve-timeout')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['x-internal-api-key']).toBe('secret-key')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.tenantId).toBe('tenant-1')
  })

  it('HTTP не-2xx (например, 503 PAYMENT_PROVIDER_UNAVAILABLE) → бросает, чтобы BullMQ ретраил (см. JSDoc процессора)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const job = new PartialFulfillmentTimeoutJob()

    await expect(
      job.process(fakeJob(JOB_DATA), { apiInternalUrl: 'http://localhost:3000', internalApiKey: 'secret-key' }),
    ).rejects.toThrow(/HTTP 503/)
  })

  it('HTTP 200 (уже разрешён клиентом, идемпотентный no-op на стороне apps/api) → не бросает', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const job = new PartialFulfillmentTimeoutJob()

    await expect(
      job.process(fakeJob(JOB_DATA), { apiInternalUrl: 'http://localhost:3000', internalApiKey: 'secret-key' }),
    ).resolves.toBeUndefined()
  })
})
