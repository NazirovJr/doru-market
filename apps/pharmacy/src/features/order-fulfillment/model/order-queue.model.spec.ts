import { describe, expect, it } from 'vitest'
import type { PharmacyTerminalQueueItemDto } from '@dorutj/contracts'
import {
  applyAcceptConflict,
  applyOptimisticAccept,
  applyQueuePatch,
  findNewlyArrivedOrderIds,
  shouldShowOfflineBanner,
  splitQueueSections,
} from './order-queue.model'

function makeItem(overrides: Partial<PharmacyTerminalQueueItemDto>): PharmacyTerminalQueueItemDto {
  return {
    id: 'order-1',
    orderNumber: 'DTJ-260925-00001',
    status: 'paid_escrow',
    itemsCount: 2,
    itemsTotalTjs: 150,
    paymentMethod: 'alif_mobi',
    prescriptionRequired: false,
    slaDeadlineAt: null,
    assignedPharmacistId: null,
    assignedPharmacistName: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}

describe('splitQueueSections', () => {
  it('делит на «Новые» (paid_escrow/confirmed, FIFO по createdAt) и «В сборке» (processing, по slaDeadlineAt)', () => {
    const items = [
      makeItem({ id: 'a', status: 'confirmed', createdAt: '2026-09-25T10:05:00.000Z' }),
      makeItem({ id: 'b', status: 'paid_escrow', createdAt: '2026-09-25T10:00:00.000Z' }),
      makeItem({ id: 'c', status: 'processing', slaDeadlineAt: '2026-09-25T10:20:00.000Z' }),
      makeItem({ id: 'd', status: 'processing', slaDeadlineAt: '2026-09-25T10:10:00.000Z' }),
    ]
    const result = splitQueueSections(items)
    expect(result.newOrders.map((item) => item.id)).toEqual(['b', 'a'])
    expect(result.processing.map((item) => item.id)).toEqual(['d', 'c'])
  })

  it('processing без slaDeadlineAt уходит в конец секции «В сборке»', () => {
    const items = [
      makeItem({ id: 'a', status: 'processing', slaDeadlineAt: null }),
      makeItem({ id: 'b', status: 'processing', slaDeadlineAt: '2026-09-25T10:10:00.000Z' }),
    ]
    expect(splitQueueSections(items).processing.map((item) => item.id)).toEqual(['b', 'a'])
  })
})

describe('findNewlyArrivedOrderIds', () => {
  it('новый id в статусе «Новые» — засчитан', () => {
    const previous = [makeItem({ id: 'a' })]
    const next = [makeItem({ id: 'a' }), makeItem({ id: 'b' })]
    expect(findNewlyArrivedOrderIds(previous, next)).toEqual(['b'])
  })

  it('переход существующего заказа в processing — НЕ считается новым прибытием', () => {
    const previous = [makeItem({ id: 'a', status: 'paid_escrow' })]
    const next = [makeItem({ id: 'a', status: 'processing' })]
    expect(findNewlyArrivedOrderIds(previous, next)).toEqual([])
  })
})

describe('applyQueuePatch', () => {
  const base = [makeItem({ id: 'a' }), makeItem({ id: 'b' })]

  it('insert — добавляет новую карточку, дубликат по id игнорирует', () => {
    const inserted = applyQueuePatch(base, { kind: 'insert', item: makeItem({ id: 'c' }) })
    expect(inserted.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(applyQueuePatch(inserted, { kind: 'insert', item: makeItem({ id: 'c' }) })).toHaveLength(3)
  })

  it('update — заменяет карточку по id, остальные не трогает', () => {
    const updated = applyQueuePatch(base, { kind: 'update', item: makeItem({ id: 'a', status: 'processing' }) })
    expect(updated.find((item) => item.id === 'a')?.status).toBe('processing')
    expect(updated.find((item) => item.id === 'b')?.status).toBe('paid_escrow')
  })

  it('remove — убирает карточку по id', () => {
    expect(applyQueuePatch(base, { kind: 'remove', id: 'a' }).map((item) => item.id)).toEqual(['b'])
  })
})

describe('applyOptimisticAccept / applyAcceptConflict', () => {
  it('applyOptimisticAccept переводит карточку в processing с текущим фармацевтом ДО ответа сервера', () => {
    const result = applyOptimisticAccept([makeItem({ id: 'a' })], 'a', 'pharmacist-1')
    const patched = result.find((item) => item.id === 'a')
    expect(patched?.status).toBe('processing')
    expect(patched?.assignedPharmacistId).toBe('pharmacist-1')
  })

  it('applyAcceptConflict откатывает оптимизм на РЕАЛЬНОГО владельца из 409 details (негативный сценарий)', () => {
    const optimistic = applyOptimisticAccept([makeItem({ id: 'a' })], 'a', 'me')
    const result = applyAcceptConflict(optimistic, 'a', { assignedPharmacistId: 'colleague-1', assignedPharmacistName: 'Фарзона М.' })
    const patched = result.find((item) => item.id === 'a')
    expect(patched?.assignedPharmacistId).toBe('colleague-1')
    expect(patched?.assignedPharmacistName).toBe('Фарзона М.')
  })
})

describe('shouldShowOfflineBanner', () => {
  it('одна неудача подряд — баннер ещё не показывается (защита от дребезга)', () => {
    expect(shouldShowOfflineBanner(1)).toBe(false)
  })

  it('две и более неудач подряд — баннер показывается', () => {
    expect(shouldShowOfflineBanner(2)).toBe(true)
    expect(shouldShowOfflineBanner(5)).toBe(true)
  })
})
