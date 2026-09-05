/**
 * `OrderQueueSortPolicy` (DTJ-301, SRS-PHT-005) — тест-план тикета: пустой список, только
 * `processing`, только `paid_escrow`, смешанный набор с `NULL sla_deadline_at`.
 */
import { describe, expect, it } from 'vitest'
import type { OrderQueueRow } from '@/modules/orders/application/ports/order-repository.port.js'
import { OrderQueueSortPolicy } from './order-queue-sort.policy.js'

/** Дефолты фикстуры — вынесены из `row()` в объект ради `complexity` (C1, ≤10 — множество `??` считалось отдельными ветками). */
const QUEUE_ROW_DEFAULTS: Omit<OrderQueueRow, 'id' | 'orderNumber'> = {
  status: 'paid_escrow',
  pharmacyId: 'pharmacy-1',
  itemsCount: 1,
  itemsTotalTjs: 100,
  paymentMethod: 'alif_mobi',
  prescriptionRequired: false,
  slaDeadlineAt: null,
  assignedPharmacistId: null,
  assignedPharmacistName: null,
  createdAt: new Date('2026-09-05T10:00:00.000Z'),
}

function row(overrides: Partial<OrderQueueRow> & Pick<OrderQueueRow, 'id'>): OrderQueueRow {
  return {
    ...QUEUE_ROW_DEFAULTS,
    orderNumber: `DTJ-260905-${overrides.id}`,
    ...overrides,
  }
}

function ids(rows: readonly OrderQueueRow[]): string[] {
  return rows.map((r) => r.id)
}

describe('OrderQueueSortPolicy.sort (DTJ-301, SRS-PHT-005)', () => {
  it('пустой список → пустой список', () => {
    expect(OrderQueueSortPolicy.sort([])).toEqual([])
  })

  it('не мутирует вход (возвращает новый массив)', () => {
    const input = [row({ id: 'a' }), row({ id: 'b' })]
    const sorted = OrderQueueSortPolicy.sort(input)
    expect(sorted).not.toBe(input)
  })

  it('только processing → по slaDeadlineAt ASC (ближе к просрочке — выше)', () => {
    const soon = row({ id: 'soon', status: 'processing', slaDeadlineAt: new Date('2026-09-05T10:05:00.000Z') })
    const later = row({ id: 'later', status: 'processing', slaDeadlineAt: new Date('2026-09-05T10:20:00.000Z') })
    const soonest = row({ id: 'soonest', status: 'processing', slaDeadlineAt: new Date('2026-09-05T10:01:00.000Z') })

    const sorted = OrderQueueSortPolicy.sort([later, soon, soonest])

    expect(ids(sorted)).toEqual(['soonest', 'soon', 'later'])
  })

  it('только paid_escrow → по createdAt ASC (FIFO)', () => {
    const third = row({ id: 'third', status: 'paid_escrow', createdAt: new Date('2026-09-05T10:03:00.000Z') })
    const first = row({ id: 'first', status: 'paid_escrow', createdAt: new Date('2026-09-05T10:01:00.000Z') })
    const second = row({ id: 'second', status: 'paid_escrow', createdAt: new Date('2026-09-05T10:02:00.000Z') })

    const sorted = OrderQueueSortPolicy.sort([third, first, second])

    expect(ids(sorted)).toEqual(['first', 'second', 'third'])
  })

  it('confirmed трактуется идентично paid_escrow — FIFO по createdAt в ТОЙ ЖЕ группе 2', () => {
    const confirmedFirst = row({ id: 'confirmed-first', status: 'confirmed', createdAt: new Date('2026-09-05T10:00:00.000Z') })
    const paidEscrowSecond = row({ id: 'paid-escrow-second', status: 'paid_escrow', createdAt: new Date('2026-09-05T10:01:00.000Z') })

    const sorted = OrderQueueSortPolicy.sort([paidEscrowSecond, confirmedFirst])

    expect(ids(sorted)).toEqual(['confirmed-first', 'paid-escrow-second'])
  })

  it('смешанный набор с NULL sla_deadline_at (processing без дедлайна — NULLS LAST внутри своей группы)', () => {
    const noDeadline = row({ id: 'no-deadline', status: 'processing', slaDeadlineAt: null })
    const withDeadline = row({ id: 'with-deadline', status: 'processing', slaDeadlineAt: new Date('2026-09-05T10:10:00.000Z') })

    const sorted = OrderQueueSortPolicy.sort([noDeadline, withDeadline])

    expect(ids(sorted)).toEqual(['with-deadline', 'no-deadline'])
  })

  it('смешанный набор: ВСЕ processing перед ЛЮБЫМ paid_escrow/confirmed, независимо от времени', () => {
    // paid_escrow создан РАНЬШЕ (10:00), чем processing получил slaDeadlineAt (10:30) — тем не
    // менее processing идёт первым (группа 1 всегда перед группой 2, SRS-PHT-005 п.1/2).
    const oldPaidEscrow = row({ id: 'old-paid-escrow', status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') })
    const lateProcessing = row({ id: 'late-processing', status: 'processing', slaDeadlineAt: new Date('2026-09-05T10:30:00.000Z') })
    const newPaidEscrow = row({ id: 'new-paid-escrow', status: 'paid_escrow', createdAt: new Date('2026-09-05T11:00:00.000Z') })

    const sorted = OrderQueueSortPolicy.sort([oldPaidEscrow, newPaidEscrow, lateProcessing])

    expect(ids(sorted)).toEqual(['late-processing', 'old-paid-escrow', 'new-paid-escrow'])
  })
})

describe('OrderQueueSortPolicy.sort — стабильность на уже убывающем порядке (форсирует обе ветки компаратора)', () => {
  it('вход в СТРОГО убывающем порядке пересортировывается в возрастающий (FIFO)', () => {
    const third = row({ id: 'third', status: 'paid_escrow', createdAt: new Date('2026-09-05T10:03:00.000Z') })
    const second = row({ id: 'second', status: 'paid_escrow', createdAt: new Date('2026-09-05T10:02:00.000Z') })
    const first = row({ id: 'first', status: 'paid_escrow', createdAt: new Date('2026-09-05T10:01:00.000Z') })

    // Вход УЖЕ в обратном порядке (third, second, first) — форсирует и `a<b`, и `a>b` ветки
    // компаратора (в отличие от уже-упорядоченного входа, где sort() может обойтись меньшим
    // числом сравнений на маленьком массиве).
    expect(ids(OrderQueueSortPolicy.sort([third, second, first]))).toEqual(['first', 'second', 'third'])
  })
})

describe('OrderQueueSortPolicy.cursorValue (DTJ-301) — монотонность относительно sort()', () => {
  it('cursorValue растёт в том же порядке, что sort() располагает строки', () => {
    const a = row({ id: 'a', status: 'processing', slaDeadlineAt: new Date('2026-09-05T10:05:00.000Z') })
    const b = row({ id: 'b', status: 'paid_escrow', createdAt: new Date('2026-09-05T09:00:00.000Z') })

    const sorted = OrderQueueSortPolicy.sort([a, b])

    expect(ids(sorted)).toEqual(['a', 'b'])
    expect(OrderQueueSortPolicy.cursorValue(a) < OrderQueueSortPolicy.cursorValue(b)).toBe(true)
  })

  it('различается по id при равном времени (детерминированный тай-брейк, не exception)', () => {
    const sameTime = new Date('2026-09-05T10:00:00.000Z')
    const x = row({ id: 'x', status: 'paid_escrow', createdAt: sameTime })
    const y = row({ id: 'y', status: 'paid_escrow', createdAt: sameTime })

    expect(OrderQueueSortPolicy.cursorValue(x)).not.toBe(OrderQueueSortPolicy.cursorValue(y))
  })
})
