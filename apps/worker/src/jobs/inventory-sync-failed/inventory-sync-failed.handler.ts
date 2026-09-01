/**
 * Failed-handler `inventory-sync-queue` (EP-05, DTJ-155, SRS-INV-035).
 *
 * Подписчик `QueueEvents('inventory-sync-queue').on('failed', ...)`.
 * Срабатывает на КАЖДОЕ `failed`-событие, поэтому ОБЯЗАН проверять
 * `job.attemptsMade >= job.opts.attempts` (тикет §«Риски»). Иначе —
 * промежуточная 1-я неудача ошибочно переводит батч в
 * `failed_validation`.
 *
 * При финальном провале:
 *   1. загрузить `InventorySyncBatch` по `job.data.batchId`;
 *   2. вызвать `markFailedValidation(errors, now)` (DTJ-144) — НЕ
 *      через прямую мутацию, а через порт, чтобы persistance-логика
 *      оставалась в инфраструктуре API (handler НЕ знает про Drizzle);
 *   3. записать ОДНУ строку `inventory_sync_errors` с
 *      `error_code='processing_failed'` (DTJ-142, миграция 0015b) и
 *      санитизированным `error_detail` (БЕЗ секретов, критерий 3);
 *   4. опубликовать алерт через `InventoryOutboxPort`.
 *
 * **Гонка (критерий 4):** батч мог уже перейти в терминальный
 * статус (`completed_*` / `failed_validation`) другим путём
 * (paralельный воркер, ручной requeue). `IllegalBatchStatusTransitionError`
 * перехватывается и логируется — процесс worker'а НЕ падает.
 */
import type { Logger } from 'pino'
import {
  ERROR_CODE_PROCESSING_FAILED,
  MAX_ERROR_DETAIL_LENGTH,
} from './inventory-sync-failed.constants.js'
import type {
  InventoryOutboxPort,
  InventorySyncBatchRepositoryPort,
  InventorySyncBatchSnapshot,
} from './inventory-sync-ports.js'
import { sanitizeErrorDetail } from './sanitize-error-detail.js'

/** Минимальный контракт `FailedJobDescriptor` от BullMQ `QueueEvents.on('failed')`. */
export interface FailedJobDescriptor {
  readonly jobId: string | undefined
  readonly attemptsMade: number
  readonly opts: { readonly attempts: number }
  readonly failedReason: string
  readonly stacktrace: readonly string[]
  readonly data: Readonly<Record<string, unknown>> | unknown
}

/** Порт `Clock` (минимальный) — определён в `inventory-sync-ports.ts` (DRY). */

/** Доменная ошибка FSM-перехода (DTJ-144, локальная копия — см. TODO). */
export class IllegalBatchStatusTransitionError extends Error {
  constructor(
    public readonly batchId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(`Cannot transition batch ${batchId} from ${fromStatus} to ${toStatus}`)
    this.name = 'IllegalBatchStatusTransitionError'
  }
}

export interface HandleFailedJobInput {
  readonly job: FailedJobDescriptor
  /** `batchId` берётся из `job.data.batchId` (SRS-INV-032). */
  readonly batchId: string
  readonly repository: InventorySyncBatchRepositoryPort
  readonly outbox: InventoryOutboxPort
  readonly logger: Logger
}

export interface HandleFailedJobResult {
  /** `true` если handler выполнил действие (финальный провал). `false` если это промежуточная попытка. */
  readonly acted: boolean
  /** `true` если был зафиксирован терминальный переход в `failed_validation`. */
  readonly markedAsFailed: boolean
}

/** Чистая функция-оркестратор (тестируется без BullMQ). */
export async function handleFailedJob(
  input: HandleFailedJobInput,
): Promise<HandleFailedJobResult> {
  const { job, batchId, repository, outbox, logger } = input

  // (1) Фильтр: только финальный провал.
  if (job.attemptsMade < job.opts.attempts) {
    return { acted: false, markedAsFailed: false }
  }

  // (2) Загрузить батч.
  const batch = await repository.findById(batchId)
  if (batch === null) {
    logger.warn(
      { batchId, attemptsMade: job.attemptsMade },
      'inventory-sync failed: batch not found (likely already cleaned up)',
    )
    return { acted: true, markedAsFailed: false }
  }

  // (3) Проверить, не в терминальном ли он уже (гонка, критерий 4).
  if (isTerminalStatus(batch.status)) {
    logger.warn(
      { batchId, currentStatus: batch.status, attemptsMade: job.attemptsMade },
      'inventory-sync failed: batch already in terminal status, skipping markFailedValidation',
    )
    return { acted: true, markedAsFailed: false }
  }

  // (4) Попытка терминального перехода. Локальный «снимок» — handler
  //     НЕ мутирует батч напрямую; реальный `markFailedValidation()`
  //     живёт в API (DTJ-144), worker выражает решение через snapshot.
  const updatedSnapshot: InventorySyncBatchSnapshot = {
    id: batch.id,
    pharmacyId: batch.pharmacyId,
    status: 'failed_validation',
    syncType: batch.syncType,
  }
  try {
    await repository.save(updatedSnapshot)
  } catch (error) {
    if (error instanceof IllegalBatchStatusTransitionError) {
      logger.warn(
        { batchId, fromStatus: error.fromStatus, toStatus: error.toStatus },
        'inventory-sync failed: race with concurrent terminal transition',
      )
      return { acted: true, markedAsFailed: false }
    }
    throw error
  }

  // (5) Записать ОДНУ строку `inventory_sync_errors`.
  const sanitized = sanitizeErrorDetail(buildErrorDetail(job))
  const truncated =
    sanitized.length > MAX_ERROR_DETAIL_LENGTH
      ? sanitized.slice(0, MAX_ERROR_DETAIL_LENGTH)
      : sanitized
  await repository.appendError({
    batchId,
    rowIndex: null,
    errorCode: ERROR_CODE_PROCESSING_FAILED,
    errorDetail: truncated,
  })

  // (6) Алерт для on-call.
  outbox.appendProcessingFailedAlert({
    eventType: 'inventory.sync_batch.processing_failed',
    batchId,
    pharmacyId: batch.pharmacyId,
    attemptsMade: job.attemptsMade,
    lastErrorCode: ERROR_CODE_PROCESSING_FAILED,
  })

  logger.error(
    { batchId, pharmacyId: batch.pharmacyId, attemptsMade: job.attemptsMade },
    'inventory-sync batch FAILED after exhausting all retries',
  )

  return { acted: true, markedAsFailed: true }
}

function isTerminalStatus(status: InventorySyncBatchSnapshot['status']): boolean {
  return (
    status === 'completed_full_success' ||
    status === 'completed_partial_success' ||
    status === 'failed_validation'
  )
}

function buildErrorDetail(job: FailedJobDescriptor): string {
  const stack = job.stacktrace.length > 0 ? job.stacktrace.join('\n') : '(no stack)'
  return `attempts=${String(job.attemptsMade)}\nreason=${job.failedReason}\nstack=\n${stack}`
}

/** Класс-обёртка для регистрации в NestJS (подписка на QueueEvents). */
export class InventorySyncFailedJobHandler {
  constructor(
    private readonly repository: InventorySyncBatchRepositoryPort,
    private readonly outbox: InventoryOutboxPort,
    private readonly logger: Logger,
  ) {}

  /** Вызывается из подписчика `QueueEvents.on('failed', ...)`. */
  async handle(job: FailedJobDescriptor): Promise<HandleFailedJobResult> {
    const data = job.data as { batchId?: unknown } | undefined
    const batchIdRaw = data?.batchId
    if (typeof batchIdRaw !== 'string') {
      this.logger.warn(
        { jobId: job.jobId, data: data ?? null },
        'inventory-sync failed: job.data.batchId is not a string',
      )
      return { acted: false, markedAsFailed: false }
    }
    return handleFailedJob({
      job,
      batchId: batchIdRaw,
      repository: this.repository,
      outbox: this.outbox,
      logger: this.logger,
    })
  }
}
