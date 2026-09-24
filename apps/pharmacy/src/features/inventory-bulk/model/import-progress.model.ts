import type { InventorySyncBatchStatusDto } from '@dorutj/contracts'

/** Терминальные статусы FSM батча (см. `inventory-sync-batch.entity.ts`, backend) — опрос агрегированного прогресса останавливается, когда ВСЕ батчи здесь. */
const TERMINAL_STATUSES: ReadonlySet<InventorySyncBatchStatusDto> = new Set([
  'completed_full_success',
  'completed_partial_success',
  'failed_validation',
])

/** Батч с частичными/полными ошибками — прогресс-бар предлагает скачать отчёт об ошибках (DTJ-164). */
const ERROR_STATUSES: ReadonlySet<InventorySyncBatchStatusDto> = new Set([
  'completed_partial_success',
  'failed_validation',
])

const PERCENT_MULTIPLIER = 100

export interface BatchProgressInput {
  readonly status: InventorySyncBatchStatusDto
}

export interface AggregateProgress {
  /** Дробный процент — округление до целого делает UI (DTJ-168 АС2), не эта функция. */
  readonly percent: number
  readonly isComplete: boolean
  readonly hasErrors: boolean
}

const ZERO_PROGRESS: AggregateProgress = { percent: 0, isComplete: false, hasErrors: false }

/**
 * Агрегирует статусы N батчей ОДНОЙ Excel-загрузки в ОДИН прогресс-бар (SRS-INV-014, DTJ-168
 * АС1-3). Чистая функция — без сети, без даты/рандома, только вход→выход.
 */
export function computeAggregateProgress(batches: readonly BatchProgressInput[]): AggregateProgress {
  if (batches.length === 0) {
    return ZERO_PROGRESS
  }
  const completedCount = batches.filter((batch) => TERMINAL_STATUSES.has(batch.status)).length
  return {
    percent: (completedCount / batches.length) * PERCENT_MULTIPLIER,
    isComplete: completedCount === batches.length,
    hasErrors: batches.some((batch) => ERROR_STATUSES.has(batch.status)),
  }
}
