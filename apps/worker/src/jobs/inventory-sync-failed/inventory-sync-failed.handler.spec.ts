/**
 * Тест `handleFailedJob` (EP-05, DTJ-155, критерии 1-4).
 */
import { describe, expect, it, vi } from 'vitest'
import { pino } from 'pino'
import { ERROR_CODE_PROCESSING_FAILED } from './inventory-sync-failed.constants.js'
import {
  IllegalBatchStatusTransitionError,
  InventorySyncFailedJobHandler,
  handleFailedJob,
  type FailedJobDescriptor,
  type HandleFailedJobInput,
} from './inventory-sync-failed.handler.js'
import type {
  InventoryOutboxPort,
  InventorySyncBatchRepositoryPort,
  InventorySyncBatchSnapshot,
} from './inventory-sync-ports.js'

const silentLogger = pino({ level: 'silent' })

function makeJob(
  overrides: Partial<FailedJobDescriptor> = {},
): FailedJobDescriptor {
  return {
    jobId: 'J-1',
    attemptsMade: 5,
    opts: { attempts: 5 },
    failedReason: 'DB connection refused',
    stacktrace: ['Error: DB connection refused\n  at /src/x.ts:42:10'],
    data: { batchId: 'B-1' },
    ...overrides,
  }
}

function makeBatch(
  overrides: Partial<InventorySyncBatchSnapshot> = {},
): InventorySyncBatchSnapshot {
  return {
    id: 'B-1',
    pharmacyId: 'P-1',
    status: 'processing',
    syncType: 'delta',
    ...overrides,
  }
}

function makeContext(overrides: Partial<HandleFailedJobInput> = {}): {
  ctx: HandleFailedJobInput
  findByIdMock: ReturnType<typeof vi.fn>
  saveMock: ReturnType<typeof vi.fn>
  appendErrorMock: ReturnType<typeof vi.fn>
  alertMock: ReturnType<typeof vi.fn>
} {
  const findByIdMock = vi.fn().mockResolvedValue(makeBatch())
  const saveMock = vi.fn().mockResolvedValue(undefined)
  const appendErrorMock = vi.fn().mockResolvedValue(undefined)
  const alertMock = vi.fn()
  const repository: InventorySyncBatchRepositoryPort = {
    findById: findByIdMock,
    save: saveMock,
    appendError: appendErrorMock,
  }
  const outbox: InventoryOutboxPort = {
    appendProcessingFailedAlert: alertMock,
  }
  return {
    ctx: {
      job: makeJob(),
      batchId: 'B-1',
      repository,
      outbox,
      logger: silentLogger,
      ...overrides,
    },
    findByIdMock,
    saveMock,
    appendErrorMock,
    alertMock,
  }
}

describe('handleFailedJob (DTJ-155, SRS-INV-035)', () => {
  it('финальный провал переводит батч в failed_validation', async () => {
    const { ctx, saveMock, appendErrorMock, alertMock } = makeContext()
    const result = await handleFailedJob(ctx)
    expect(result).toEqual({ acted: true, markedAsFailed: true })
    expect(saveMock).toHaveBeenCalledTimes(1)
    const saved = saveMock.mock.calls[0] as unknown[]
    const snapshot = saved[0] as InventorySyncBatchSnapshot
    expect(snapshot.status).toBe('failed_validation')
    expect(appendErrorMock).toHaveBeenCalledTimes(1)
    const errArgs = appendErrorMock.mock.calls[0] as unknown[]
    const errInput = errArgs[0] as { errorCode: string; errorDetail: string }
    expect(errInput.errorCode).toBe(ERROR_CODE_PROCESSING_FAILED)
    expect(alertMock).toHaveBeenCalledTimes(1)
  })

  it('промежуточная неудача (attemptsMade < opts.attempts) НЕ меняет статус', async () => {
    const { ctx, saveMock, appendErrorMock, alertMock } = makeContext({
      job: makeJob({ attemptsMade: 2, opts: { attempts: 5 } }),
    })
    const result = await handleFailedJob(ctx)
    expect(result).toEqual({ acted: false, markedAsFailed: false })
    expect(saveMock).not.toHaveBeenCalled()
    expect(appendErrorMock).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('error_detail санитизирован: X-Pharmacy-Signature не попадает в БД', async () => {
    const { ctx, appendErrorMock } = makeContext({
      job: makeJob({
        failedReason: 'request header: X-Pharmacy-Signature: super-secret-sig-9876 failed',
        stacktrace: ['Error: signature mismatch for X-Pharmacy-Signature: another-secret-sig-5432'],
      }),
    })
    await handleFailedJob(ctx)
    const errArgs = appendErrorMock.mock.calls[0] as unknown[]
    const errInput = errArgs[0] as { errorDetail: string }
    expect(errInput.errorDetail).not.toContain('super-secret-sig-9876')
    expect(errInput.errorDetail).not.toContain('another-secret-sig-5432')
  })

  it('батч в completed_partial_success — гонка: НЕ перезаписывается, исключения нет', async () => {
    const { ctx, saveMock, appendErrorMock, alertMock } = makeContext({
      job: makeJob(),
    })
    ctx.repository.findById = vi
      .fn()
      .mockResolvedValue(makeBatch({ status: 'completed_partial_success' }))
    const result = await handleFailedJob(ctx)
    expect(result).toEqual({ acted: true, markedAsFailed: false })
    expect(saveMock).not.toHaveBeenCalled()
    expect(appendErrorMock).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('батч в failed_validation — уже терминальный, handler no-op', async () => {
    const { ctx, saveMock } = makeContext()
    ctx.repository.findById = vi
      .fn()
      .mockResolvedValue(makeBatch({ status: 'failed_validation' }))
    const result = await handleFailedJob(ctx)
    expect(result.markedAsFailed).toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('IllegalBatchStatusTransitionError от repository.save() — перехватывается', async () => {
    const { ctx, alertMock } = makeContext()
    ctx.repository.save = vi
      .fn()
      .mockRejectedValue(
        new IllegalBatchStatusTransitionError('B-1', 'processing', 'failed_validation'),
      )
    const result = await handleFailedJob(ctx)
    expect(result.acted).toBe(true)
    expect(result.markedAsFailed).toBe(false)
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('error_detail усекается до MAX_ERROR_DETAIL_LENGTH (4_000)', async () => {
    const { ctx, appendErrorMock } = makeContext({
      job: makeJob({
        stacktrace: Array.from({ length: 1000 }, (_, i) => `at /src/x${String(i)}.ts:42:10`),
      }),
    })
    await handleFailedJob(ctx)
    const errArgs = appendErrorMock.mock.calls[0] as unknown[]
    const errInput = errArgs[0] as { errorDetail: string }
    expect(errInput.errorDetail.length).toBeLessThanOrEqual(4_000)
  })

  it('батч не найден (findById→null) — handler не падает, no-op', async () => {
    const { ctx, saveMock, alertMock } = makeContext()
    ctx.repository.findById = vi.fn().mockResolvedValue(null)
    const result = await handleFailedJob(ctx)
    expect(result.acted).toBe(true)
    expect(result.markedAsFailed).toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('repository.save() бросает НЕ IllegalBatchStatusTransitionError — пробрасывается наружу', async () => {
    const { ctx } = makeContext()
    const unexpectedError = new Error('unique constraint violation')
    ctx.repository.save = vi.fn().mockRejectedValue(unexpectedError)

    await expect(handleFailedJob(ctx)).rejects.toBe(unexpectedError)
  })
})

describe('InventorySyncFailedJobHandler (класс-обёртка для QueueEvents)', () => {
  function makePorts(): {
    findByIdMock: ReturnType<typeof vi.fn>
    saveMock: ReturnType<typeof vi.fn>
    appendErrorMock: ReturnType<typeof vi.fn>
    alertMock: ReturnType<typeof vi.fn>
    handler: InventorySyncFailedJobHandler
  } {
    const findByIdMock = vi.fn().mockResolvedValue(makeBatch())
    const saveMock = vi.fn().mockResolvedValue(undefined)
    const appendErrorMock = vi.fn().mockResolvedValue(undefined)
    const alertMock = vi.fn()
    const repository: InventorySyncBatchRepositoryPort = {
      findById: findByIdMock,
      save: saveMock,
      appendError: appendErrorMock,
    }
    const outbox: InventoryOutboxPort = { appendProcessingFailedAlert: alertMock }
    const handler = new InventorySyncFailedJobHandler(repository, outbox, silentLogger)
    return { findByIdMock, saveMock, appendErrorMock, alertMock, handler }
  }

  it('job.data.batchId — строка: делегирует в handleFailedJob с этим batchId', async () => {
    const { handler, findByIdMock } = makePorts()

    const result = await handler.handle(makeJob({ data: { batchId: 'B-1' } }))

    expect(result).toEqual({ acted: true, markedAsFailed: true })
    expect(findByIdMock).toHaveBeenCalledWith('B-1')
  })

  it('job.data.batchId отсутствует/не строка — warn и no-op, порты НЕ вызываются', async () => {
    const { handler, findByIdMock, saveMock, appendErrorMock, alertMock } = makePorts()

    const result = await handler.handle(makeJob({ data: { batchId: 123 } }))

    expect(result).toEqual({ acted: false, markedAsFailed: false })
    expect(findByIdMock).not.toHaveBeenCalled()
    expect(saveMock).not.toHaveBeenCalled()
    expect(appendErrorMock).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('job.data вообще undefined — тот же no-op, без исключения', async () => {
    const { handler, findByIdMock } = makePorts()

    const result = await handler.handle(makeJob({ data: undefined }))

    expect(result).toEqual({ acted: false, markedAsFailed: false })
    expect(findByIdMock).not.toHaveBeenCalled()
  })
})
