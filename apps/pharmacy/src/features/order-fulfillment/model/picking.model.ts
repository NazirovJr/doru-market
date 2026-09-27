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

export function hasUnavailableItem(items: readonly PharmacyTerminalOrderItemDto[]): boolean {
  return items.some((item) => item.fulfillmentStatus === 'unavailable')
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

/** `complete-picking` → ключ i18n. `PARTIAL_FULFILLMENT_PENDING` сюда не попадает — баннер ожидания вместо текста ошибки (п.4 «Что сделать» DTJ-312). */
export function resolveCompletePickingErrorMessageKey(code: string): string {
  switch (code) {
    case ErrorCode.SEAL_CONFIRMATION_REQUIRED as string:
      return 'pharmacy.picking.complete.error.seal_required'
    case ErrorCode.EXPIRED_STOCK as string:
      return 'pharmacy.picking.complete.error.expired_stock'
    default:
      return 'pharmacy.picking.complete.error.generic'
  }
}

/** Given код ошибки `complete-picking` (или `null` — ошибки нет), текст баннера. `PARTIAL_FULFILLMENT_PENDING` — `null` (баннер ожидания вместо текста, см. `resolveCompletePickingErrorMessageKey`). Вынесено из `PickingPage` — C1 (`complexity`, порог 10). */
export function resolveCompletePickingBannerErrorMessage(t: (key: string) => string, code: string | null): string | null {
  if (code === null) return null
  if (code === (ErrorCode.PARTIAL_FULFILLMENT_PENDING as string)) return null
  return t(resolveCompletePickingErrorMessageKey(code))
}

/** `422 EXPIRED_STOCK` на `complete-picking` (DTJ-312 доработка) — `details.itemIds` для подсветки конкретной позиции (см. `assertNoExpiredBatch`/`InventoryFacadePort.findExpiredReservedItemIds`, apps/api). Тот же приём, что `readResolvedName` выше — сервер решает форму `details`, клиент читает защитно. */
export function readExpiredStockItemIds(details: unknown): readonly string[] {
  if (typeof details !== 'object' || details === null) return []
  const itemIds = (details as { itemIds?: unknown }).itemIds
  return Array.isArray(itemIds) ? itemIds.filter((id): id is string => typeof id === 'string') : []
}

