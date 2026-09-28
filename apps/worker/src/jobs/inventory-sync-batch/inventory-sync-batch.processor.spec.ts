// `bullmq`/HTTP-мост замоканы (конвенция unpaid-order-timeout.scheduler.spec.ts) — проверяем только оркестрацию.
import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { InventorySyncBatchProcessor } from './inventory-sync-batch.processor.js'
import { requestProcessInventorySyncBatch } from './process-inventory-sync-batch.client.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock }) {
    this.close = fakeWorkerClose
  }),
}))

vi.mock('./process-inventory-sync-batch.client.js', () => ({
  API_INTERNAL_URL_TOKEN: Symbol('API_INTERNAL_URL_TOKEN'),
  INTERNAL_API_KEY_TOKEN: Symbol('INTERNAL_API_KEY_TOKEN'),
  requestProcessInventorySyncBatch: vi.fn(),
}))

function makeJob(data: unknown): Job {
  return { id: 'job-1', data } as unknown as Job
}

describe('InventorySyncBatchProcessor (DTJ-441)', () => {
  let processor: InventorySyncBatchProcessor
  let handleJob: (job: Job) => Promise<void>

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    processor = new InventorySyncBatchProcessor({} as Redis, 'http://internal-api', 'secret-key')
    processor.onModuleInit()
    const call = (Worker as unknown as Mock).mock.calls[0] as [string, (job: Job) => Promise<void>]
    handleJob = call[1]
  })

  it('onModuleInit создаёт Worker на имени очереди inventory-sync-queue', () => {
    expect(Worker).toHaveBeenCalledTimes(1)
    const [queueName] = (Worker as unknown as Mock).mock.calls[0] as [string]
    expect(queueName).toBe('inventory-sync-queue')
  })

  it('валидный batchId — вызывает HTTP-мост ровно с этим batchId и конфигом из конструктора', async () => {
    await handleJob(makeJob({ batchId: 'batch-1' }))

    expect(requestProcessInventorySyncBatch).toHaveBeenCalledWith(
      { apiInternalUrl: 'http://internal-api', internalApiKey: 'secret-key' },
      'batch-1',
    )
  })

  it('провал HTTP-моста пробрасывается наружу — BullMQ ретраит по заданным при постановке job опциям', async () => {
    ;(requestProcessInventorySyncBatch as Mock).mockRejectedValueOnce(new Error('HTTP 500'))

    await expect(handleJob(makeJob({ batchId: 'batch-1' }))).rejects.toThrow('HTTP 500')
  })

  it('job.data.batchId не строка — логирует и НЕ вызывает HTTP-мост (не роняет worker на мусорных данных)', async () => {
    await handleJob(makeJob({ batchId: 42 }))

    expect(requestProcessInventorySyncBatch).not.toHaveBeenCalled()
  })

  it('onModuleDestroy закрывает Worker', async () => {
    await processor.onModuleDestroy()
    expect(fakeWorkerClose).toHaveBeenCalledTimes(1)
  })
})
