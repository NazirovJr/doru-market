import { describe, expect, it } from 'vitest'
import { isOk, isErr } from '@dorutj/domain-kernel'
import {
  CodForbiddenForRxError,
  CodLimitExceededError,
  ControlledSubstanceNotOrderableError,
  ExpiredStockError,
  InvalidOrderStatusTransitionError,
  OrderPharmacyMismatchError,
  OrderTotalMismatchError,
  PharmacySuspendedError,
  PrescriptionNotVerifiedError,
  type OrderStatus,
} from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import {
  validOrderCreateCommand,
  validOrderItemCommand,
} from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { fixedDate } from '@/modules/orders/testing/fixtures/fixed-date.fixture.js'
import { Order, type OrderSnapshot } from './order.entity.js'
import { ORDER_ALLOWED_TRANSITIONS } from './order.state-machine.js'

const NOW = fixedDate('2026-08-27T10:00:00.000Z')
const SLA_DEADLINE = fixedDate('2026-08-27T10:07:00.000Z')

/**
 * Свежий `Order`, затем принудительно поставленный в произвольный `status` через `restore()`
 * — обходит реальный жизненный цикл, чтобы протестировать КАЖДУЮ пару (статус × метод).
 * `paymentMethod` выбирается по `status`, а не хардкодится: `restore()` теперь сам отказывает
 * снимку `cash_courier + {pending_payment,paid_escrow}` и `non-cash + confirmed` (D-25,
 * доработка после ревью CTO) — `confirmed` достижим ТОЛЬКО через `cash_courier`, остальные
 * статусы — ТОЛЬКО через non-cash, иначе сама фикстура бросала бы на восстановлении.
 */
function orderAtStatus(status: OrderStatus, snapshotOverrides: Partial<OrderSnapshot> = {}): Order {
  const paymentMethod = status === 'confirmed' ? 'cash_courier' : 'alif_mobi'
  const created = Order.create(validOrderCreateCommand({ paymentMethod }))
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status, ...snapshotOverrides })
}

describe('Order.create() — инварианты создания (DTJ-221)', () => {
  it('AC1: валидная команда → Ok(order) с orderNumber и комиссией на каждой позиции', () => {
    const result = Order.create(validOrderCreateCommand())
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.orderNumber.value).toBe('DTJ-260827-00001')
    expect(result.value.items[0]?.commissionBps).toBe(800)
    expect(result.value.items[0]?.platformFeeDiram).toBeGreaterThan(0n)
  })

  it('AC2: controlCategory=narcotic → Err(ControlledSubstanceNotOrderableError)', () => {
    const result = Order.create(
      validOrderCreateCommand({ items: [validOrderItemCommand({ controlCategory: 'narcotic' })] }),
    )
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(ControlledSubstanceNotOrderableError)
  })

  it('controlCategory=psychotropic → Err(ControlledSubstanceNotOrderableError)', () => {
    const result = Order.create(
      validOrderCreateCommand({ items: [validOrderItemCommand({ controlCategory: 'psychotropic' })] }),
    )
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(ControlledSubstanceNotOrderableError)
  })

  it('AC3: Rx-позиция без prescriptionId → Err(PrescriptionNotVerifiedError)', () => {
    const result = Order.create(
      validOrderCreateCommand({
        items: [validOrderItemCommand({ isPrescriptionRequired: true })],
        prescriptionId: null,
      }),
    )
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(PrescriptionNotVerifiedError)
  })

  it('Rx-позиция С prescriptionId → Ok', () => {
    const result = Order.create(
      validOrderCreateCommand({
        items: [validOrderItemCommand({ isPrescriptionRequired: true })],
        prescriptionId: 'prescription-1',
      }),
    )
    expect(isOk(result)).toBe(true)
  })

  it('AC4: cash_courier, total > COD-лимита → Err(CodLimitExceededError)', () => {
    const item = validOrderItemCommand({ unitPrice: Money.fromDiram(60_000n), quantity: 1 })
    const deliveryFee = Money.fromDiram(0n)
    const result = Order.create(
      validOrderCreateCommand({
        items: [item],
        deliveryFee,
        totalAmount: item.unitPrice.multiplyByQuantity(1).add(deliveryFee),
        paymentMethod: 'cash_courier',
      }),
    )
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(CodLimitExceededError)
  })

  it('cash_courier + Rx-позиция → Err(CodForbiddenForRxError)', () => {
    const item = validOrderItemCommand({ isPrescriptionRequired: true })
    const deliveryFee = Money.fromDiram(1_500n)
    const result = Order.create(
      validOrderCreateCommand({
        items: [item],
        deliveryFee,
        totalAmount: item.unitPrice.multiplyByQuantity(item.quantity).add(deliveryFee),
        paymentMethod: 'cash_courier',
        prescriptionId: 'prescription-1',
      }),
    )
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(CodForbiddenForRxError)
  })

  it('AC5: total ≠ itemsTotal + deliveryFee → Err(OrderTotalMismatchError)', () => {
    const result = Order.create(validOrderCreateCommand({ totalAmount: Money.fromDiram(1n) }))
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(OrderTotalMismatchError)
  })

  it('позиции разных аптек (SRS-DOM-002, defensive) → Err(OrderPharmacyMismatchError)', () => {
    const items = [validOrderItemCommand({ pharmacyId: 'pharmacy-1' }), validOrderItemCommand({ pharmacyId: 'pharmacy-2' })]
    const itemsTotal = items.reduce((sum, i) => sum.add(i.unitPrice.multiplyByQuantity(i.quantity)), Money.fromDiram(0n))
    const deliveryFee = Money.fromDiram(1_500n)
    const result = Order.create(
      validOrderCreateCommand({ pharmacyId: 'pharmacy-1', items, deliveryFee, totalAmount: itemsTotal.add(deliveryFee) }),
    )
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(OrderPharmacyMismatchError)
  })

  it('пустой список позиций → Err(ValidationError)', () => {
    const result = Order.create(validOrderCreateCommand({ items: [], totalAmount: Money.fromDiram(1_500n) }))
    expect(isErr(result)).toBe(true)
  })

  it('аптека не активна (SRS-DOM-012) → Err(PharmacySuspendedError)', () => {
    const result = Order.create(validOrderCreateCommand({ isPharmacyActiveAtCreation: false }))
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(PharmacySuspendedError)
  })

  it('cash_courier валидный → Ok, статус СРАЗУ confirmed (D-25), НЕ pending_payment', () => {
    const item = validOrderItemCommand({ unitPrice: Money.fromDiram(1_000n), quantity: 1 })
    const deliveryFee = Money.fromDiram(500n)
    const result = Order.create(
      validOrderCreateCommand({
        items: [item],
        deliveryFee,
        totalAmount: item.unitPrice.multiplyByQuantity(1).add(deliveryFee),
        paymentMethod: 'cash_courier',
      }),
    )
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.status).toBe('confirmed')
    expect(result.value.toSnapshot().paymentTransactionId).toBeNull()
  })

  it('non-cash валидный → Ok, статус pending_payment', () => {
    const result = Order.create(validOrderCreateCommand({ paymentMethod: 'alif_mobi' }))
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.status).toBe('pending_payment')
  })
})

describe('order.confirm() — D-25 (DTJ-222)', () => {
  it('AC1: заказ cash_courier только что создан → confirmed, повторный markPaidEscrow бросает', () => {
    const item = validOrderItemCommand({ unitPrice: Money.fromDiram(1_000n), quantity: 1 })
    const deliveryFee = Money.fromDiram(0n)
    const result = Order.create(
      validOrderCreateCommand({
        items: [item],
        deliveryFee,
        totalAmount: item.unitPrice.multiplyByQuantity(1).add(deliveryFee),
        paymentMethod: 'cash_courier',
      }),
    )
    if (!isOk(result)) throw new Error('expected Ok')
    const order = result.value
    expect(order.status).toBe('confirmed')
    expect(() => {
      order.markPaidEscrow('tx-1', NOW, true)
    }).toThrow(InvalidOrderStatusTransitionError)
  })

  it('AC2: заказ в paid_escrow, When order.confirm() (гипотетическая ошибка) → throws', () => {
    const order = orderAtStatus('paid_escrow')
    expect(() => {
      order.confirm(NOW)
    }).toThrow(InvalidOrderStatusTransitionError)
  })

  it('non-cash заказ в pending_payment, When order.confirm() (программная ошибка) → throws', () => {
    const order = orderAtStatus('pending_payment', { paymentMethod: 'alif_mobi' })
    expect(() => {
      order.confirm(NOW)
    }).toThrow(InvalidOrderStatusTransitionError)
  })
})

describe('markPaidEscrow/restore — структурная недостижимость paid_escrow для cash_courier (доработка по ревью CTO)', () => {
  it('markPaidEscrow бросает для cash_courier независимо от статуса (явная проверка paymentMethod, не только assertTransition)', () => {
    // До этой доработки markPaidEscrow проверял ТОЛЬКО ALLOWED_TRANSITIONS. Для 'confirmed'
    // assertTransition САМ по себе уже отказал бы (paid_escrow не в списке исходящих для
    // confirmed) — поэтому дополнительно проверяем, что причина отказа — именно paymentMethod
    // (details.reason), а не совпадение с независимо действующей проверкой таблицы. Это и есть
    // тот asymmetричный рубеж защиты, которого раньше не было (симметрично confirm()).
    const order = orderAtStatus('confirmed', { paymentMethod: 'cash_courier' })
    try {
      order.markPaidEscrow('tx-1', NOW, true)
      expect.unreachable('markPaidEscrow должен был бросить для cash_courier')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOrderStatusTransitionError)
      expect((error as InvalidOrderStatusTransitionError).details?.reason).toContain('cash_courier')
    }
  })

  it('restore(): снимок cash_courier + pending_payment — испорченная строка (SRS-ORD-027 п.1), бросает', () => {
    const created = Order.create(validOrderCreateCommand({ paymentMethod: 'cash_courier' }))
    if (!isOk(created)) throw new Error('expected Ok')
    const corrupted = { ...created.value.toSnapshot(), status: 'pending_payment' as const }
    expect(() => Order.restore(corrupted)).toThrow(/corrupted Order snapshot/)
  })

  it('restore(): снимок cash_courier + paid_escrow — испорченная строка (D-25, структурно недостижимо), бросает', () => {
    // Ровно сценарий из ревью CTO: DEFAULT-строка 0023_orders_cart.sql (status='pending_payment')
    // для cash_courier, "догнанная" гипотетическим прямым UPDATE до paid_escrow — restore()
    // отказывает ДО того, как markPaidEscrow вообще стал бы вызываться на такой строке.
    const created = Order.create(validOrderCreateCommand({ paymentMethod: 'cash_courier' }))
    if (!isOk(created)) throw new Error('expected Ok')
    const corrupted = { ...created.value.toSnapshot(), status: 'paid_escrow' as const }
    expect(() => Order.restore(corrupted)).toThrow(/corrupted Order snapshot/)
  })

  it('restore(): снимок non-cash + confirmed — испорченная строка (SRS-ORD-028, симметричное расширение), бросает', () => {
    const created = Order.create(validOrderCreateCommand({ paymentMethod: 'alif_mobi' }))
    if (!isOk(created)) throw new Error('expected Ok')
    const corrupted = { ...created.value.toSnapshot(), status: 'confirmed' as const }
    expect(() => Order.restore(corrupted)).toThrow(/corrupted Order snapshot/)
  })

  it('restore(): легитимные комбинации (cash_courier+confirmed, non-cash+pending_payment) проходят без ошибок', () => {
    const cash = Order.create(validOrderCreateCommand({ paymentMethod: 'cash_courier' }))
    const nonCash = Order.create(validOrderCreateCommand({ paymentMethod: 'alif_mobi' }))
    if (!isOk(cash) || !isOk(nonCash)) throw new Error('expected Ok')
    expect(() => Order.restore(cash.value.toSnapshot())).not.toThrow()
    expect(() => Order.restore(nonCash.value.toSnapshot())).not.toThrow()
  })
})

describe('order.startProcessing() (DTJ-222, SRS-DOM-091/178/006)', () => {
  it('AC3: confirmed → processing, slaDeadlineAt установлен', () => {
    const order = orderAtStatus('confirmed', { paymentMethod: 'cash_courier' })
    order.startProcessing({ pharmacistId: 'pharmacist-1', slaDeadlineAt: SLA_DEADLINE, hasExpiredReservedBatch: false }, NOW)
    expect(order.status).toBe('processing')
    expect(order.toSnapshot().slaDeadlineAt).toEqual(SLA_DEADLINE)
  })

  it('paid_escrow → processing — идентично ветке confirmed', () => {
    const order = orderAtStatus('paid_escrow')
    order.startProcessing({ pharmacistId: 'pharmacist-1', slaDeadlineAt: SLA_DEADLINE, hasExpiredReservedBatch: false }, NOW)
    expect(order.status).toBe('processing')
  })

  it('hasExpiredReservedBatch=true (SRS-DOM-006) → ExpiredStockError, статус не меняется', () => {
    const order = orderAtStatus('paid_escrow')
    expect(() => {
      order.startProcessing({ pharmacistId: 'pharmacist-1', slaDeadlineAt: NOW, hasExpiredReservedBatch: true }, NOW)
    }).toThrow(ExpiredStockError)
    expect(order.status).toBe('paid_escrow')
  })
})

describe('OrderPolicy-релевантные переходы и заготовки EP-11 (DTJ-222)', () => {
  it('processing → picked_up, handoverOtpId сохранён', () => {
    const order = orderAtStatus('processing')
    order.markPickedUp('otp-1', NOW)
    expect(order.status).toBe('picked_up')
    expect(order.toSnapshot().handoverOtpId).toBe('otp-1')
  })

  it('picked_up → delivered', () => {
    const order = orderAtStatus('picked_up')
    order.markDelivered(NOW)
    expect(order.status).toBe('delivered')
  })

  it('cancel() записывает reason/cancelledBy, эмитирует OrderCancelledEvent', () => {
    const order = orderAtStatus('paid_escrow')
    order.cancel('customer_changed_mind', { kind: 'user', userId: 'user-1' }, NOW)
    expect(order.status).toBe('cancelled')
    expect(order.toSnapshot().cancelReason).toBe('customer_changed_mind')
    expect(order.toSnapshot().cancelledBy).toBe('user-1')
    const events = order.pullDomainEvents()
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'OrderCancelledEvent', reason: 'customer_changed_mind' }),
    )
  })

  it('system-инициированная отмена → cancelledBy=null', () => {
    const order = orderAtStatus('pending_payment')
    order.cancel('payment_timeout', { kind: 'system' }, NOW)
    expect(order.toSnapshot().cancelledBy).toBeNull()
  })

  it('AC4/AC5: attachReturn — заготовка EP-11, picked_up/delivered → return_in_progress', () => {
    const fromPickedUp = orderAtStatus('picked_up')
    fromPickedUp.attachReturn('return-1', NOW)
    expect(fromPickedUp.status).toBe('return_in_progress')

    const fromDelivered = orderAtStatus('delivered')
    fromDelivered.attachReturn('return-1', NOW)
    expect(fromDelivered.status).toBe('return_in_progress')
  })

  it('markRefunded — заготовка EP-11, return_in_progress → refunded', () => {
    const order = orderAtStatus('return_in_progress')
    order.markRefunded('refund-1', NOW)
    expect(order.status).toBe('refunded')
  })
})

describe('Исчерпывающая матрица переходов (DTJ-222 DoD — ALLOWED_TRANSITIONS единственный источник)', () => {
  const ALL_STATUSES = Object.keys(ORDER_ALLOWED_TRANSITIONS) as OrderStatus[]

  const METHODS: Record<string, { target: OrderStatus; call: (order: Order) => void }> = {
    markPaidEscrow: {
      target: 'paid_escrow',
      call: (o) => {
        o.markPaidEscrow('tx-1', NOW, true)
      },
    },
    startProcessing: {
      target: 'processing',
      call: (o) => {
        o.startProcessing({ pharmacistId: 'p-1', slaDeadlineAt: NOW, hasExpiredReservedBatch: false }, NOW)
      },
    },
    markPickedUp: {
      target: 'picked_up',
      call: (o) => {
        o.markPickedUp('otp-1', NOW)
      },
    },
    markDelivered: {
      target: 'delivered',
      call: (o) => {
        o.markDelivered(NOW)
      },
    },
    cancel: {
      target: 'cancelled',
      call: (o) => {
        o.cancel('customer_changed_mind', { kind: 'system' }, NOW)
      },
    },
    attachReturn: {
      target: 'return_in_progress',
      call: (o) => {
        o.attachReturn('r-1', NOW)
      },
    },
    markRefunded: {
      target: 'refunded',
      call: (o) => {
        o.markRefunded('rf-1', NOW)
      },
    },
  }

  const cases: readonly [OrderStatus, string][] = ALL_STATUSES.flatMap((status) =>
    Object.keys(METHODS).map((method): [OrderStatus, string] => [status, method]),
  )

  it.each(cases)('из %s → %s: соответствует ORDER_ALLOWED_TRANSITIONS', (status, methodName) => {
    const { target, call } = METHODS[methodName]!
    const order = orderAtStatus(status)
    const allowed = ORDER_ALLOWED_TRANSITIONS[status].includes(target)
    if (allowed) {
      expect(() => {
        call(order)
      }).not.toThrow()
      expect(order.status).toBe(target)
    } else {
      expect(() => {
        call(order)
      }).toThrow(InvalidOrderStatusTransitionError)
      expect(order.status).toBe(status) // побочный эффект отсутствует при отказе
    }
  })
})

describe('Инвариант типов: markPaidEscrow требует ledgerHoldWillBeRecorded=true (SRS-DOM-180/ORD-027a)', () => {
  it('компилятор отклоняет вызов без обязательного параметра', () => {
    const order = orderAtStatus('pending_payment', { paymentMethod: 'alif_mobi' })
    // @ts-expect-error — ledgerHoldWillBeRecorded обязателен, не булев-опция.
    order.markPaidEscrow('tx-1', NOW)
  })
})
