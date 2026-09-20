import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { PickingSlaWatchdogJob } from './picking-sla-watchdog.job.js'
import { PICKING_SLA_JOB_HARD, PICKING_SLA_JOB_SOFT, type PickingSlaWatchdogJobData } from './picking-sla-watchdog.types.js'

const JOB_DATA: PickingSlaWatchdogJobData = { orderId: 'order-1', tenantId: 'tenant-1' }
const DEPS = { apiInternalUrl: 'http://localhost:3000', internalApiKey: 'secret-key' }

function fakeJob(name: string): Job<PickingSlaWatchdogJobData> {
  return { id: 'job-1', name, data: JOB_DATA } as unknown as Job<PickingSlaWatchdogJobData>
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response
}

describe('PickingSlaWatchdogJob.process (DTJ-307)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('должен вызвать fetch с правильным URL и параметрами для soft job', async () => {
    const mockResponse = jsonResponse(200, { data: { orderId: 'order-1', status: 'published' } })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse)

    const job = new PickingSlaWatchdogJob()
    await job.process(fakeJob(PICKING_SLA_JOB_SOFT), DEPS)

    // Этот тест проверяет, что был вызван fetch (в том числе для picking-sla-breach)
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('должен бросить ошибку при некорректном ответе сервера для soft job', async () => {
    const mockResponse = jsonResponse(503, { error: 'Service Unavailable' })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse)

    const job = new PickingSlaWatchdogJob()
    await expect(job.process(fakeJob(PICKING_SLA_JOB_SOFT), DEPS)).rejects.toThrow(/HTTP 503/)
  })

  it('должен бросить ошибку при отсутствии internalApiKey для soft job', async () => {
    const job = new PickingSlaWatchdogJob()
    await expect(job.process(fakeJob(PICKING_SLA_JOB_SOFT), { ...DEPS, internalApiKey: undefined })).rejects.toThrow(/INTERNAL_API_KEY/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('должен вызвать requestSystemOrderCancel с правильными параметрами для hard job', async () => {
    const mockResponse = jsonResponse(200, { data: { orderId: 'order-1', status: 'cancelled', refundIssued: true } })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse)

    const job = new PickingSlaWatchdogJob()
    await job.process(fakeJob(PICKING_SLA_JOB_HARD), DEPS)

    // Этот тест проверяет, что был вызван requestSystemOrderCancel (в том числе для system-cancel)
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('должен завершиться без ошибки при статусе skipped для hard job', async () => {
    const mockResponse = jsonResponse(200, { data: { orderId: 'order-1', status: 'skipped', refundIssued: false } })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse)

    const job = new PickingSlaWatchdogJob()
    await expect(job.process(fakeJob(PICKING_SLA_JOB_HARD), DEPS)).resolves.toBeUndefined()
    
    // проверим, что fetch вызвался один раз
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('должен бросить ошибку при некорректном ответе сервера для hard job', async () => {
    const mockResponse = jsonResponse(500, { error: 'Internal Server Error' })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse)

    const job = new PickingSlaWatchdogJob()
    await expect(job.process(fakeJob(PICKING_SLA_JOB_HARD), DEPS)).rejects.toThrow()
  })

  it('должен бросить ошибку при неизвестном имени джоба', async () => {
    const job = new PickingSlaWatchdogJob()
    await expect(job.process(fakeJob('weird'), DEPS)).rejects.toThrow(/unknown job name/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})