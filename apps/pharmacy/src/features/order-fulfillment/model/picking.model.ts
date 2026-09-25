/** Чистые функции производного UI-состояния экрана сборки — вычисления вынесены из компонентов. */
import { ErrorCode, type OrderDto, type OrderItemDto, type PharmacyTerminalOrderItemDto } from '@dorutj/contracts'

export function isOrderCancelled(order: Pick<OrderDto, 'status'>): boolean {
  return order.status === 'cancelled'
}

export function isItemActionable(item: PharmacyTerminalOrderItemDto, order: Pick<OrderDto, 'status'>): boolean {
  return item.fulfillmentStatus === 'pending' && !isOrderCancelled(order)
}

export function areAllItemsResolved(items: readonly PharmacyTerminalOrderItemDto[]): boolean {
  return items.every((item) => item.fulfillmentStatus !== 'pending')
}

// `medicineName` не перезаписывается — её нет в ответе `scan`/`report-issue`, остальное — от сервера.
export function mergeUpdatedItem(
  items: readonly PharmacyTerminalOrderItemDto[],
  updated: OrderItemDto,
): readonly PharmacyTerminalOrderItemDto[] {
  return items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
}

// Следующая pending-позиция после решённой, обход зацикливается на начало списка.
export function findNextPendingItemId(items: readonly PharmacyTerminalOrderItemDto[], resolvedItemId: string): string | null {
  const resolvedIndex = items.findIndex((item) => item.id === resolvedItemId)
  const ordered = resolvedIndex === -1 ? items : [...items.slice(resolvedIndex + 1), ...items.slice(0, resolvedIndex + 1)]
  const next = ordered.find((item) => item.id !== resolvedItemId && item.fulfillmentStatus === 'pending')
  return next?.id ?? null
}

function readResolvedName(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null
  const resolvedName = (details as { resolvedName?: unknown }).resolvedName
  return typeof resolvedName === 'string' ? resolvedName : null
}

// `resolvedName` приходит от сервера не всегда — универсальный текст остаётся резервом.
export function resolveWrongBarcodeMessage(t: (key: string, params?: Record<string, string>) => string, details: unknown): string {
  const resolvedName = readResolvedName(details)
  return resolvedName === null
    ? t('pharmacy.picking.scan.error.wrong_barcode')
    : t('pharmacy.picking.scan.error.wrong_barcode_named', { name: resolvedName })
}

/** Коды ошибок `scan` → ключ i18n — тот же приём, что `checkout-result-section.tsx#resolveFailedGroupReasonKey`. */
export function resolveScanErrorMessageKey(code: string): string {
  switch (code) {
    case ErrorCode.ORDER_ITEM_NOT_FOUND as string:
      return 'pharmacy.picking.scan.error.wrong_barcode'
    case ErrorCode.ITEM_ALREADY_SCANNED as string:
      return 'pharmacy.picking.scan.error.already_scanned'
    case ErrorCode.EXPIRED_STOCK as string:
      return 'pharmacy.picking.scan.error.expired_stock'
    case ErrorCode.BATCH_NOT_AVAILABLE as string:
      return 'pharmacy.picking.scan.error.batch_not_available'
    default:
      return 'pharmacy.picking.scan.error.generic'
  }
}

const SLA_WARNING_THRESHOLD_SECONDS = 120

export function computeRemainingSeconds(deadlineAt: string | null, nowMs: number): number | null {
  if (deadlineAt === null) return null
  return Math.max(0, Math.floor((new Date(deadlineAt).getTime() - nowMs) / 1000))
}

export function isSlaNearingBreach(remainingSeconds: number | null): boolean {
  return remainingSeconds !== null && remainingSeconds <= SLA_WARNING_THRESHOLD_SECONDS
}

const SECONDS_PER_MINUTE = 60

export function formatRemainingClock(remainingSeconds: number): string {
  const minutes = Math.floor(remainingSeconds / SECONDS_PER_MINUTE)
  const seconds = remainingSeconds % SECONDS_PER_MINUTE
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}
