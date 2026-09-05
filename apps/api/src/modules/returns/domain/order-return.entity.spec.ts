import { describe, expect, it } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import type { ReturnStatus } from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { InvalidMoneyError } from '@/shared-kernel/domain/errors/invalid-money.error.js'
import { fixedDate } from '@/shared-kernel/testing/fixtures/fixed-date.fixture.js'
import { OrderReturn, type OrderReturnRequestCommand, type OrderReturnSnapshot } from './order-return.entity.js'
import { ReturnReason } from './value-objects/return-reason.vo.js'
import { DuplicateActiveReturnError } from './errors/duplicate-active-return.error.js'
import { RestockConditionsNotMetError } from './errors/restock-conditions-not-met.error.js'
import { ControlledSubstanceMustBeDestroyedError } from './errors/controlled-substance-must-be-destroyed.error.js'
import { InvalidReturnStatusTransitionError } from './errors/invalid-return-status-transition.error.js'
import { UnsupportedReturnReasonError } from './errors/unsupported-return-reason.error.js'

const NOW = fixedDate('2026-06-01T00:00:00Z')
const FAR_FUTURE_EXPIRY = fixedDate('2027-01-01T00:00:00Z')
const NEAR_EXPIRY = fixedDate('2026-06-05T00:00:00Z') // 4 days out — under a 30-day buffer
const MIN_REMAINING_DAYS = 30

function baseCommand(overrides: Partial<OrderReturnRequestCommand> = {}): OrderReturnRequestCommand {
  return {
    id: 'return-1',
    orderId: 'order-1',
    reason: ReturnReason.fromTrusted('defect'),
    initiatedBy: 'customer-1',
    initiatorRole: 'customer',
    existingNonTerminalReturnIds: [],
    ...overrides,
  }
}

function buildSnapshot(status: ReturnStatus, overrides: Partial<OrderReturnSnapshot> = {}): OrderReturnSnapshot {
  return {
    id: 'return-1',
    orderId: 'order-1',
    status,
    reason: ReturnReason.fromTrusted('defect'),
    disposition: null,
    initiatedBy: 'customer-1',
    initiatorRole: 'customer',
    courierId: null,
    courierReturnFeeDiram: Money.fromDiram(0n),
    packagingIntact: null,
    checklistNotes: null,
    adminOverrideReason: null,
    adminOverrideBy: null,
    requestedAt: NOW,
    resolvedAt: null,
    ...overrides,
  }
}

describe('OrderReturn.request()', () => {
  it('ветка ПОСЛЕ вручения (SRS-RET-002): reason≠undelivered → return_requested, courierId не заполнен', () => {
    const orderReturn = OrderReturn.request(baseCommand({ reason: ReturnReason.fromTrusted('defect') }), NOW)
    expect(orderReturn.status).toBe('return_requested')
    expect(orderReturn.courierId).toBeNull()
    expect(orderReturn.requestedAt).toEqual(NOW)
  })

  it('ветка ДО вручения (SRS-RET-001): reason=refused_at_door + courierId → сразу return_in_transit', () => {
    const orderReturn = OrderReturn.request(
      baseCommand({
        reason: ReturnReason.fromTrusted('refused_at_door'),
        courierId: 'courier-9',
        courierReturnFeeDiram: Money.fromDiram(500n),
      }),
      NOW,
    )
    expect(orderReturn.status).toBe('return_in_transit')
    expect(orderReturn.courierId).toBe('courier-9')
    expect(orderReturn.courierReturnFeeDiram.diram).toBe(500n)
  })

  it('ветка ДО вручения: reason=undeliverable — тот же путь, что refused_at_door', () => {
    const orderReturn = OrderReturn.request(
      baseCommand({ reason: ReturnReason.fromTrusted('undeliverable'), courierId: 'courier-9', courierReturnFeeDiram: Money.fromDiram(0n) }),
      NOW,
    )
    expect(orderReturn.status).toBe('return_in_transit')
  })

  it('ветка ДО вручения без courierId — ValidationError (SRS-RET-001)', () => {
    expect(() => OrderReturn.request(baseCommand({ reason: ReturnReason.fromTrusted('refused_at_door') }), NOW)).toThrow(
      ValidationError,
    )
  })

  it('дубликат нетерминального возврата — DuplicateActiveReturnError (SRS-DOM-052, аналог TC-DOM-028)', () => {
    expect(() =>
      OrderReturn.request(baseCommand({ existingNonTerminalReturnIds: ['existing-return-1'] }), NOW),
    ).toThrow(DuplicateActiveReturnError)
  })

  it('reason=undelivered — UnsupportedReturnReasonError, строка order_returns НЕ создаётся (SRS-RET-003)', () => {
    expect(() => OrderReturn.request(baseCommand({ reason: ReturnReason.fromTrusted('undelivered') }), NOW)).toThrow(
      UnsupportedReturnReasonError,
    )
  })
})

describe('OrderReturn.markInTransit()', () => {
  it('return_requested → return_in_transit, курьер и сбор проставлены', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_requested'))
    orderReturn.markInTransit('courier-2', Money.fromDiram(750n))
    expect(orderReturn.status).toBe('return_in_transit')
    expect(orderReturn.courierId).toBe('courier-2')
    expect(orderReturn.courierReturnFeeDiram.diram).toBe(750n)
  })

  it('courierReturnFeeDirams < 0 отклоняется на уровне VO Money, до вызова markInTransit', () => {
    expect(() => Money.fromDiram(-1n)).toThrow(InvalidMoneyError)
  })
})

describe('OrderReturn.confirmReceived()', () => {
  const eligibleRestock = { expiryDate: FAR_FUTURE_EXPIRY, minRemainingDays: MIN_REMAINING_DAYS, hasControlledSubstance: false }

  it('все условия restock выполнены + requestRestock=true → disposition=restock, без исключения', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_in_transit'))
    const result = orderReturn.confirmReceived(
      { checklist: { packagingIntact: true }, restockEligibility: eligibleRestock, requestRestock: true },
      NOW,
    )
    expect(result.disposition.value).toBe('restock')
    expect(orderReturn.status).toBe('return_confirmed')
    expect(orderReturn.disposition?.value).toBe('restock')
    expect(orderReturn.resolvedAt).toEqual(NOW)
  })

  it('упаковка вскрыта (packagingIntact=false) + requestRestock=true → disposition=destroy, бросает RestockConditionsNotMetError (аналог TC-DOM-030)', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_in_transit'))
    expect(() =>
      orderReturn.confirmReceived(
        { checklist: { packagingIntact: false }, restockEligibility: eligibleRestock, requestRestock: true },
        NOW,
      ),
    ).toThrow(RestockConditionsNotMetError)
    expect(orderReturn.disposition?.value).toBe('destroy')
    expect(orderReturn.status).toBe('return_confirmed')
  })

  it('срок годности не проходит буфер + requestRestock=true → disposition=destroy, бросает RestockConditionsNotMetError', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_in_transit'))
    expect(() =>
      orderReturn.confirmReceived(
        {
          checklist: { packagingIntact: true },
          restockEligibility: { expiryDate: NEAR_EXPIRY, minRemainingDays: MIN_REMAINING_DAYS, hasControlledSubstance: false },
          requestRestock: true,
        },
        NOW,
      ),
    ).toThrow(RestockConditionsNotMetError)
    expect(orderReturn.disposition?.value).toBe('destroy')
  })

  it('контролируемое вещество (упаковка цела, срок годности в порядке) + requestRestock=true → ControlledSubstanceMustBeDestroyedError, disposition принудительно destroy (аналог TC-DOM-029, НЕГАТИВНЫЙ сценарий)', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_in_transit'))
    expect(() =>
      orderReturn.confirmReceived(
        {
          checklist: { packagingIntact: true },
          restockEligibility: { ...eligibleRestock, hasControlledSubstance: true },
          requestRestock: true,
        },
        NOW,
      ),
    ).toThrow(ControlledSubstanceMustBeDestroyedError)
    expect(orderReturn.disposition?.value).toBe('destroy')
  })

  it('requestRestock=false — переход в return_confirmed без исключения, disposition=destroy (пассивная приёмка)', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_in_transit'))
    const result = orderReturn.confirmReceived(
      { checklist: { packagingIntact: false }, restockEligibility: eligibleRestock, requestRestock: false },
      NOW,
    )
    expect(result.disposition.value).toBe('destroy')
    expect(orderReturn.status).toBe('return_confirmed')
  })
})

describe('OrderReturn — цикл reject() → retryTransit() → markInTransit() (не-терминальность return_rejected, SRS-DOM-056)', () => {
  it('полный цикл повторной попытки транзита', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_requested'))
    orderReturn.markInTransit('courier-1', Money.fromDiram(100n))
    expect(orderReturn.status).toBe('return_in_transit')

    orderReturn.reject('упаковка пуста', NOW)
    expect(orderReturn.status).toBe('return_rejected')
    expect(orderReturn.resolvedAt).toEqual(NOW)

    orderReturn.retryTransit('courier-2', Money.fromDiram(150n))
    expect(orderReturn.status).toBe('return_in_transit')
    expect(orderReturn.courierId).toBe('courier-2')
    expect(orderReturn.courierReturnFeeDiram.diram).toBe(150n)
    expect(orderReturn.resolvedAt).toBeNull()
  })
})

describe('OrderReturn.adminOverride()', () => {
  it('пустой reason — ValidationError (обязательный параметр, admin_override_reason NOT NULL)', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_rejected'))
    expect(() => { orderReturn.adminOverride('admin-1', '', NOW); }).toThrow(ValidationError)
    expect(() => { orderReturn.adminOverride('admin-1', '   ', NOW); }).toThrow(ValidationError)
  })

  it('return_rejected → return_confirmed, disposition принудительно restock (REQ-RET-9)', () => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_rejected'))
    orderReturn.adminOverride('admin-1', 'клиент предоставил доказательства брака', NOW)
    expect(orderReturn.status).toBe('return_confirmed')
    expect(orderReturn.disposition?.value).toBe('restock')
    expect(orderReturn.adminOverrideBy).toBe('admin-1')
    expect(orderReturn.adminOverrideReason).toBe('клиент предоставил доказательства брака')
  })
})

describe('OrderReturn — терминальность return_confirmed (критерий приёмки 4 DTJ-271)', () => {
  it.each(['markInTransit', 'reject', 'retryTransit'] as const)('%s из return_confirmed бросает InvalidReturnStatusTransitionError', (method) => {
    const orderReturn = OrderReturn.restore(buildSnapshot('return_confirmed'))
    const call = (): void => {
      if (method === 'markInTransit') orderReturn.markInTransit('c', Money.fromDiram(0n))
      if (method === 'reject') orderReturn.reject('x', NOW)
      if (method === 'retryTransit') orderReturn.retryTransit('c', Money.fromDiram(0n))
    }
    expect(call).toThrow(InvalidReturnStatusTransitionError)
  })
})

describe('OrderReturn — полная таблица недопустимых переходов (тест-план DTJ-271)', () => {
  const mutators: Record<string, (r: OrderReturn) => void> = {
    markInTransit: (r) => {
      r.markInTransit('courier-x', Money.fromDiram(10n))
    },
    confirmReceived: (r) => {
      r.confirmReceived(
        {
          checklist: { packagingIntact: true },
          restockEligibility: { expiryDate: FAR_FUTURE_EXPIRY, minRemainingDays: 1, hasControlledSubstance: false },
          requestRestock: false,
        },
        NOW,
      )
    },
    reject: (r) => {
      r.reject('x', NOW)
    },
    adminOverride: (r) => {
      r.adminOverride('admin-1', 'reason', NOW)
    },
    retryTransit: (r) => {
      r.retryTransit('courier-y', Money.fromDiram(10n))
    },
  }
  const targetByMethod: Record<string, ReturnStatus> = {
    markInTransit: 'return_in_transit',
    confirmReceived: 'return_confirmed',
    reject: 'return_rejected',
    adminOverride: 'return_confirmed',
    retryTransit: 'return_in_transit',
  }
  const allStatuses: readonly ReturnStatus[] = [
    'return_requested',
    'return_in_transit',
    'returned_to_pharmacy',
    'return_confirmed',
    'return_rejected',
  ]
  // ALLOWED-таблица инлайнится здесь намеренно (не импортируется из state-machine.ts) — тест
  // проверяет РЕАЛЬНОЕ поведение методов сущности, а не просто эхо той же таблицы обратно на себя.
  const allowedTargets: Record<ReturnStatus, readonly ReturnStatus[]> = {
    return_requested: ['return_in_transit'],
    return_in_transit: ['return_confirmed', 'return_rejected'],
    returned_to_pharmacy: [],
    return_confirmed: [],
    return_rejected: ['return_confirmed', 'return_in_transit'],
  }

  for (const status of allStatuses) {
    for (const [methodName, mutate] of Object.entries(mutators)) {
      const target = targetByMethod[methodName]
      const isAllowed = target !== undefined && allowedTargets[status].includes(target)
      if (isAllowed) continue
      it(`${methodName}() из ${status} — недопустимый переход, бросает InvalidReturnStatusTransitionError`, () => {
        const orderReturn = OrderReturn.restore(buildSnapshot(status))
        expect(() => { mutate(orderReturn); }).toThrow(InvalidReturnStatusTransitionError)
      })
    }
  }
})

describe('OrderReturn.toSnapshot()/restore() — round-trip для репозитория', () => {
  it('toSnapshot() возвращает все поля, restore() восстанавливает эквивалентный объект', () => {
    const original = OrderReturn.request(baseCommand(), NOW)
    const snapshot = original.toSnapshot()
    const restored = OrderReturn.restore(snapshot)
    expect(restored.toSnapshot()).toEqual(snapshot)
  })
})
