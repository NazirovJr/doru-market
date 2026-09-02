/**
 * Тест `InventorySyncFailedListener` (EP-05, DTJ-155). `bullmq` замокан — без мока
 * `QueueEvents`/`Job.fromId` пытаются открыть реальное соединение с Redis (конвенция
 * license-expiry-check.scheduler.spec.ts / prune-search-query-log.scheduler.spec.ts).
 */
import { Logger } from '@nestjs/common'
import { QueueEvents } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { FailedJobDescriptor, InventorySyncFailedJobHandler } from './inventory-sync-failed.handler.js'
import { INVENTORY_SYNC_QUEUE_NAME } from './inventory-sync-failed.constants.js'
import { InventorySyncFailedListener } from './inventory-sync-failed.listener.js'

type FailedListener = (payload: { jobId: string; failedReason: string; prev: string | undefined }) => void

// `vi.mock` факторка хойстится над импортами — переменные для неё должны быть объявлены
// через `vi.hoisted`, иначе `onMock`/`closeMock`/`fromIdMock` ещё не инициализированы.
const { onMock, closeMock, fromIdMock } = vi.hoisted(() => ({
  onMock: vi.fn<(event: string, listener: FailedListener) => void>(),
  closeMock: vi.fn().mockResolvedValue(undefined),
  fromIdMock: vi.fn(),
}))

vi.mock('bullmq', () => ({
  QueueEvents: vi.fn().mockImplementation(function fakeQueueEvents(this: {
    on: typeof onMock
    close: typeof closeMock
  }) {
    this.on = onMock
    this.close = closeMock
  }),
  Job: { fromId: fromIdMock },
}))

function captureFailedListener(): FailedListener {
  const call = onMock.mock.calls.find(([event]) => event === 'failed')
  if (call === undefined) {
    throw new Error('failed listener was not registered')
  }
  return call[1]
}

describe('InventorySyncFailedListener', () => {
  let connection: Redis
  let handleMock: Mock<InventorySyncFailedJobHandler['handle']>
  let handler: InventorySyncFailedJobHandler
  let listener: InventorySyncFailedListener

  beforeEach(() => {
    vi.clearAllMocks()
    connection = {} as Redis
    handleMock = vi.fn().mockResolvedValue({ acted: true, markedAsFailed: true })
    handler = { handle: handleMock } as unknown as InventorySyncFailedJobHandler
    listener = new InventorySyncFailedListener(connection, handler)
  })

  it('onModuleInit подписывается на `failed` очереди INVENTORY_SYNC_QUEUE_NAME', () => {
    listener.onModuleInit()

    expect(QueueEvents).toHaveBeenCalledWith(INVENTORY_SYNC_QUEUE_NAME, { connection })
    expect(onMock).toHaveBeenCalledWith('failed', expect.any(Function))
  })

  it('job найден через Job.fromId — дескриптор берёт data/opts.attempts/attemptsMade из job', async () => {
    fromIdMock.mockResolvedValue({
      data: { batchId: 'B-1' },
      opts: { attempts: 7 },
      attemptsMade: 10,
    })
    listener.onModuleInit()
    const onFailed = captureFailedListener()

    onFailed({ jobId: 'J-1', failedReason: 'boom', prev: '2' })
    await vi.waitFor(() => {
      expect(handleMock).toHaveBeenCalledTimes(1)
    })

    const [descriptor] = handleMock.mock.calls[0] as [FailedJobDescriptor]
    expect(descriptor).toEqual({
      jobId: 'J-1',
      attemptsMade: 10,
      opts: { attempts: 7 },
      failedReason: 'boom',
      stacktrace: [],
      data: { batchId: 'B-1' },
    })
  })

  it('job НЕ найден (Job.fromId → undefined) — фолбэк на event-only данные, warn, handler всё равно вызван', async () => {
    fromIdMock.mockResolvedValue(undefined)
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    listener.onModuleInit()
    const onFailed = captureFailedListener()

    onFailed({ jobId: 'J-2', failedReason: 'cleaned up', prev: '3' })
    await vi.waitFor(() => {
      expect(handleMock).toHaveBeenCalledTimes(1)
    })

    const [descriptor] = handleMock.mock.calls[0] as [FailedJobDescriptor]
    expect(descriptor).toEqual({
      jobId: 'J-2',
      attemptsMade: 4,
      opts: { attempts: 5 },
      failedReason: 'cleaned up',
      stacktrace: [],
      data: {},
    })
    expect(warnSpy).toHaveBeenCalled()
  })

  it('Job.fromId бросает исключение — перехватывается, warn, handler получает фолбэк-дескриптор', async () => {
    fromIdMock.mockRejectedValue(new Error('redis timeout'))
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    listener.onModuleInit()
    const onFailed = captureFailedListener()

    onFailed({ jobId: 'J-3', failedReason: 'timeout', prev: undefined })
    await vi.waitFor(() => {
      expect(handleMock).toHaveBeenCalledTimes(1)
    })

    const [descriptor] = handleMock.mock.calls[0] as [FailedJobDescriptor]
    expect(descriptor.attemptsMade).toBe(1)
    expect(descriptor.data).toEqual({})
    expect(warnSpy).toHaveBeenCalled()
  })

  it('handler.handle() отклоняется — перехватывается и логируется, процесс не падает', async () => {
    fromIdMock.mockResolvedValue(undefined)
    handleMock.mockRejectedValue(new Error('handler crashed'))
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    listener.onModuleInit()
    const onFailed = captureFailedListener()

    onFailed({ jobId: 'J-4', failedReason: 'boom', prev: undefined })
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledTimes(1)
    })

    const [meta] = errorSpy.mock.calls[0] as [{ jobId: string; err: string }]
    expect(meta.jobId).toBe('J-4')
    expect(meta.err).toBe('handler crashed')
  })

  it('failedReason не строка — дескриптор получает "unknown"', async () => {
    fromIdMock.mockResolvedValue(undefined)
    listener.onModuleInit()
    const onFailed = captureFailedListener()

    onFailed({ jobId: 'J-5', failedReason: undefined as unknown as string, prev: undefined })
    await vi.waitFor(() => {
      expect(handleMock).toHaveBeenCalledTimes(1)
    })

    const [descriptor] = handleMock.mock.calls[0] as [FailedJobDescriptor]
    expect(descriptor.failedReason).toBe('unknown')
  })

  it('onModuleDestroy закрывает QueueEvents и обнуляет ссылку — повторный вызов не падает', async () => {
    listener.onModuleInit()

    await listener.onModuleDestroy()
    expect(closeMock).toHaveBeenCalledTimes(1)

    await listener.onModuleDestroy()
    expect(closeMock).toHaveBeenCalledTimes(1)
  })

  it('onModuleDestroy без предварительного onModuleInit — no-op, не падает', async () => {
    await expect(listener.onModuleDestroy()).resolves.toBeUndefined()
    expect(closeMock).not.toHaveBeenCalled()
  })
})
