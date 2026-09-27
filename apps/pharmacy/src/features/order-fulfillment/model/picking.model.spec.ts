import { describe, expect, it } from 'vitest'
import type { OrderDto, OrderItemDto, PharmacyTerminalOrderItemDto } from '@dorutj/contracts'
import {
  areAllItemsResolved,
  findNextPendingItemId,
  hasUnavailableItem,
  isItemActionable,
  isOrderCancelled,
  mergeUpdatedItem,
  resolveCompletePickingErrorMessageKey,
  resolveScanErrorMessageKey,
  resolveWrongBarcodeMessage,
} from './picking.model'

function makeItem(overrides: Partial<PharmacyTerminalOrderItemDto>): PharmacyTerminalOrderItemDto {
  return {
    id: 'item-1',
    orderId: 'order-1',
    medicineId: 'med-1',
    medicineName: 'Парацетамол 500мг',
    unitPriceDiram: 1000,
    quantity: 1,
    totalPriceDiram: 1000,
    commissionBps: 500,
    platformFeeDiram: 50,
    fulfillmentStatus: 'pending',
    scannedBatchId: null,
    scannedAt: null,
    scannedBy: null,
    scanMethod: null,
    itemIssueReason: null,
    ...overrides,
  }
}

function makeOrder(status: OrderDto['status']): Pick<OrderDto, 'status'> {
  return { status }
}

// Реальный ответ scan/report-issue — голый OrderItemDto, без medicineName (в отличие от makeItem выше).
function makeOrderItemResponse(overrides: Partial<OrderItemDto> & { readonly id: string }): OrderItemDto {
  const { medicineName: _medicineName, ...rest } = makeItem(overrides)
  return rest
}

describe('picking.model — isOrderCancelled/isItemActionable', () => {
  it('заказ cancelled — isOrderCancelled true', () => {
    expect(isOrderCancelled(makeOrder('cancelled'))).toBe(true)
    expect(isOrderCancelled(makeOrder('processing'))).toBe(false)
  })

  it('pending-позиция активного заказа — actionable', () => {
    expect(isItemActionable(makeItem({ fulfillmentStatus: 'pending' }), makeOrder('processing'))).toBe(true)
  })

  it('scanned_ok-позиция — НЕ actionable (нечего решать повторно)', () => {
    expect(isItemActionable(makeItem({ fulfillmentStatus: 'scanned_ok' }), makeOrder('processing'))).toBe(false)
  })

  it('pending-позиция ОТМЕНЁННОГО заказа — НЕ actionable (SRS-PHT-068, негативный сценарий)', () => {
    expect(isItemActionable(makeItem({ fulfillmentStatus: 'pending' }), makeOrder('cancelled'))).toBe(false)
  })
})

describe('picking.model — areAllItemsResolved', () => {
  it('пустой список — resolved (vacuous true)', () => {
    expect(areAllItemsResolved([])).toBe(true)
  })

  it('есть хотя бы один pending — НЕ resolved', () => {
    expect(areAllItemsResolved([makeItem({ id: 'a', fulfillmentStatus: 'scanned_ok' }), makeItem({ id: 'b', fulfillmentStatus: 'pending' })])).toBe(false)
  })

  it('все scanned_ok/unavailable — resolved', () => {
    expect(areAllItemsResolved([makeItem({ id: 'a', fulfillmentStatus: 'scanned_ok' }), makeItem({ id: 'b', fulfillmentStatus: 'unavailable' })])).toBe(true)
  })
})

describe('picking.model — mergeUpdatedItem', () => {
  it('обновляет поля позиции по id, СОХРАНЯЯ medicineName (его нет в ответе scan/report-issue)', () => {
    const items = [makeItem({ id: 'a', medicineName: 'Ибупрофен' })]
    const updated = makeOrderItemResponse({ id: 'a', fulfillmentStatus: 'scanned_ok', scannedAt: '2026-09-25T10:00:00.000Z' })
    const result = mergeUpdatedItem(items, updated)
    expect(result[0]?.fulfillmentStatus).toBe('scanned_ok')
    expect(result[0]?.medicineName).toBe('Ибупрофен')
  })

  it('чужой id — список не меняется', () => {
    const items = [makeItem({ id: 'a' })]
    const result = mergeUpdatedItem(items, makeOrderItemResponse({ id: 'other' }))
    expect(result).toEqual(items)
  })
})

describe('picking.model — findNextPendingItemId (эргономика последовательного сканирования)', () => {
  it('переходит к следующей pending-позиции после решённой', () => {
    const items = [
      makeItem({ id: 'a', fulfillmentStatus: 'scanned_ok' }),
      makeItem({ id: 'b', fulfillmentStatus: 'pending' }),
      makeItem({ id: 'c', fulfillmentStatus: 'pending' }),
    ]
    expect(findNextPendingItemId(items, 'a')).toBe('b')
  })

  it('оборачивается в начало списка, если pending-позиция стоит ДО решённой', () => {
    const items = [
      makeItem({ id: 'a', fulfillmentStatus: 'pending' }),
      makeItem({ id: 'b', fulfillmentStatus: 'scanned_ok' }),
    ]
    expect(findNextPendingItemId(items, 'b')).toBe('a')
  })

  it('больше нет pending-позиций — null', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'scanned_ok' })]
    expect(findNextPendingItemId(items, 'a')).toBeNull()
  })
})

describe('picking.model — resolveWrongBarcodeMessage', () => {
  const t = (key: string, params?: Record<string, string>): string => (params?.name !== undefined ? `${key}:${params.name}` : key)

  it('details без resolvedName — универсальный текст', () => {
    expect(resolveWrongBarcodeMessage(t, { orderId: 'x' })).toBe('pharmacy.picking.scan.error.wrong_barcode')
  })

  it('details c resolvedName — именованный текст', () => {
    expect(resolveWrongBarcodeMessage(t, { resolvedName: 'Ибупрофен' })).toBe('pharmacy.picking.scan.error.wrong_barcode_named:Ибупрофен')
  })
})

describe('picking.model — resolveScanErrorMessageKey', () => {
  it.each([
    ['ORDER_ITEM_NOT_FOUND', 'pharmacy.picking.scan.error.wrong_barcode'],
    ['ITEM_ALREADY_SCANNED', 'pharmacy.picking.scan.error.already_scanned'],
    ['EXPIRED_STOCK', 'pharmacy.picking.scan.error.expired_stock'],
    ['BATCH_NOT_AVAILABLE', 'pharmacy.picking.scan.error.batch_not_available'],
    ['SOME_OTHER_CODE', 'pharmacy.picking.scan.error.generic'],
  ])('%s -> %s', (code, expectedKey) => {
    expect(resolveScanErrorMessageKey(code)).toBe(expectedKey)
  })
})

describe('picking.model — resolveCompletePickingErrorMessageKey', () => {
  it.each([
    ['SEAL_CONFIRMATION_REQUIRED', 'pharmacy.picking.complete.error.seal_required'],
    ['EXPIRED_STOCK', 'pharmacy.picking.complete.error.expired_stock'],
    ['SOME_OTHER_CODE', 'pharmacy.picking.complete.error.generic'],
  ])('%s -> %s', (code, expectedKey) => {
    expect(resolveCompletePickingErrorMessageKey(code)).toBe(expectedKey)
  })
})

describe('picking.model — hasUnavailableItem', () => {
  it('нет unavailable-позиций — false', () => {
    expect(hasUnavailableItem([makeItem({ id: 'a', fulfillmentStatus: 'scanned_ok' })])).toBe(false)
  })

  it('есть хотя бы одна unavailable-позиция — true', () => {
    expect(
      hasUnavailableItem([makeItem({ id: 'a', fulfillmentStatus: 'scanned_ok' }), makeItem({ id: 'b', fulfillmentStatus: 'unavailable' })]),
    ).toBe(true)
  })
})
