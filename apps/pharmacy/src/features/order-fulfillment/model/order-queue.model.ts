import type { PharmacyTerminalQueueItemDto } from '@dorutj/contracts'

export const NEW_QUEUE_STATUSES = ['paid_escrow', 'confirmed'] as const
export const PROCESSING_QUEUE_STATUS = 'processing'

export interface OrderQueueSections {
  readonly newOrders: readonly PharmacyTerminalQueueItemDto[]
  readonly processing: readonly PharmacyTerminalQueueItemDto[]
}

function isNewStatus(status: string): boolean {
  return (NEW_QUEUE_STATUSES as readonly string[]).includes(status)
}

// nulls (SLA ещё не выставлен) — в конец: такой карточке не грозит просрочка раньше остальных.
function compareBySlaDeadline(a: PharmacyTerminalQueueItemDto, b: PharmacyTerminalQueueItemDto): number {
  if (a.slaDeadlineAt === null && b.slaDeadlineAt === null) return 0
  if (a.slaDeadlineAt === null) return 1
  if (b.slaDeadlineAt === null) return -1
  return a.slaDeadlineAt.localeCompare(b.slaDeadlineAt)
}

function compareByCreatedAtFifo(a: PharmacyTerminalQueueItemDto, b: PharmacyTerminalQueueItemDto): number {
  return a.createdAt.localeCompare(b.createdAt)
}

export function splitQueueSections(items: readonly PharmacyTerminalQueueItemDto[]): OrderQueueSections {
  return {
    newOrders: items.filter((item) => isNewStatus(item.status)).slice().sort(compareByCreatedAtFifo),
    processing: items.filter((item) => item.status === PROCESSING_QUEUE_STATUS).slice().sort(compareBySlaDeadline),
  }
}

// Только реально новый id в секции «Новые» — переход статуса в processing не повод сыграть звук повторно.
export function findNewlyArrivedOrderIds(
  previous: readonly PharmacyTerminalQueueItemDto[],
  next: readonly PharmacyTerminalQueueItemDto[],
): readonly string[] {
  const previousIds = new Set(previous.map((item) => item.id))
  return next.filter((item) => isNewStatus(item.status) && !previousIds.has(item.id)).map((item) => item.id)
}

// Заготовка под будущий WS-обработчик (DTJ-308).
export type QueuePatch =
  | { readonly kind: 'insert'; readonly item: PharmacyTerminalQueueItemDto }
  | { readonly kind: 'update'; readonly item: PharmacyTerminalQueueItemDto }
  | { readonly kind: 'remove'; readonly id: string }

export function applyQueuePatch(
  items: readonly PharmacyTerminalQueueItemDto[],
  patch: QueuePatch,
): readonly PharmacyTerminalQueueItemDto[] {
  switch (patch.kind) {
    case 'insert':
      return items.some((item) => item.id === patch.item.id) ? items : [...items, patch.item]
    case 'update':
      return items.map((item) => (item.id === patch.item.id ? patch.item : item))
    case 'remove':
      return items.filter((item) => item.id !== patch.id)
  }
}

export function applyOptimisticAccept(
  items: readonly PharmacyTerminalQueueItemDto[],
  orderId: string,
  pharmacistId: string,
): readonly PharmacyTerminalQueueItemDto[] {
  const existing = items.find((item) => item.id === orderId)
  if (existing === undefined) return items
  return applyQueuePatch(items, {
    kind: 'update',
    item: { ...existing, status: PROCESSING_QUEUE_STATUS, assignedPharmacistId: pharmacistId },
  })
}

// Патч на реального коллегу-владельца из 409 details вместо простого rollback.
export function applyAcceptConflict(
  items: readonly PharmacyTerminalQueueItemDto[],
  orderId: string,
  conflict: { readonly assignedPharmacistId: string; readonly assignedPharmacistName: string | null },
): readonly PharmacyTerminalQueueItemDto[] {
  const existing = items.find((item) => item.id === orderId)
  if (existing === undefined) return items
  return applyQueuePatch(items, {
    kind: 'update',
    item: {
      ...existing,
      status: PROCESSING_QUEUE_STATUS,
      assignedPharmacistId: conflict.assignedPharmacistId,
      assignedPharmacistName: conflict.assignedPharmacistName,
    },
  })
}

// ≥2 подряд неудачных опроса — защита от дребезга одного пропущенного тика.
const OFFLINE_BANNER_FAILURE_THRESHOLD = 2

export function shouldShowOfflineBanner(consecutiveFailures: number): boolean {
  return consecutiveFailures >= OFFLINE_BANNER_FAILURE_THRESHOLD
}
