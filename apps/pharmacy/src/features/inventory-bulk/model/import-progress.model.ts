import type { InventorySyncBatchStatusDto } from '@dorutj/contracts'

// Терминальные статусы FSM батча (backend inventory-sync-batch.entity.ts) — опрос останавливается, когда все батчи здесь.
const TERMINAL_STATUSES: ReadonlySet<InventorySyncBatchStatusDto> = new Set([
  'completed_full_success',
  'completed_partial_success',
  'failed_validation',
])

const ERROR_STATUSES: ReadonlySet<InventorySyncBatchStatusDto> = new Set([
  'completed_partial_success',
  'failed_validation',
])

const PERCENT_MULTIPLIER = 100

export interface BatchProgressInput {
  readonly status: InventorySyncBatchStatusDto
}

export interface AggregateProgress {
  readonly percent: number
  readonly isComplete: boolean
  readonly hasErrors: boolean
}

const ZERO_PROGRESS: AggregateProgress = { percent: 0, isComplete: false, hasErrors: false }

// Округление до целого процента — в UI, не здесь.
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
