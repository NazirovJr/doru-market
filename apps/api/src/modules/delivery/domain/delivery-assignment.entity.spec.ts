import { describe, expect, it } from 'vitest'
import { isErr, isOk } from '@dorutj/domain-kernel'
import {
  CashAmountMismatchError,
  ColdChainBagNotConfirmedError,
  CourierNotEligibleError,
  CourierTenantMismatchError,
  DuplicateActiveDeliveryAssignmentError,
  ForbiddenTransitionError,
  ValidationError,
} from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { fixedDate } from '@/modules/delivery/testing/fixtures/fixed-date.fixture.js'
import { DeliveryAssignment, type CourierAssignmentEligibility } from './delivery-assignment.entity.js'

const NOW = fixedDate('2026-08-27T10:00:00.000Z')
const LATER = fixedDate('2026-08-27T10:05:00.000Z')
const ORDER_ID = 'order-1'
const COURIER: CourierAssignmentEligibility = {
  courierId: 'courier-1',
  courierChainId: null,
  coldChainCertified: false,
}

function freshAssignment(requiresColdChain = false): DeliveryAssignment {
  const result = DeliveryAssignment.create({
    id: 'assignment-1',
    orderId: ORDER_ID,
    landmarkText: 'Green gate',
    requiresColdChain,
    hasActiveNonTerminalAssignment: false,
    now: NOW,
  })
  if (!isOk(result)) throw new Error('fixture: expected Ok')
  return result.value
}

describe('DeliveryAssignment.create() — SRS-DOM-036 (АС3 тикета)', () => {
  it('валидная команда → Ok, status=unassigned', () => {
    const assignment = freshAssignment()
    expect(assignment.status).toBe('unassigned')
    expect(assignment.courierId).toBeNull()
  })

  it('hasActiveNonTerminalAssignment=true → Err(DuplicateActiveDeliveryAssignmentError), без БД', () => {
    const result = DeliveryAssignment.create({
      id: 'assignment-2',
      orderId: ORDER_ID,
      landmarkText: null,
      requiresColdChain: false,
      hasActiveNonTerminalAssignment: true,
      now: NOW,
    })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error).toBeInstanceOf(DuplicateActiveDeliveryAssignmentError)
  })
})

describe('assign() — unassigned → assigned (SRS-DOM-037/038)', () => {
  it('успешно назначает курьера пула (chainId=null)', () => {
    const assignment = freshAssignment()
    assignment.assign({ courier: COURIER, orderPharmacyChainId: 'chain-x', now: NOW })
    expect(assignment.status).toBe('assigned')
    expect(assignment.courierId).toBe('courier-1')
  })

  it('курьер своей сети (chainId совпадает) — успешно', () => {
    const assignment = freshAssignment()
    assignment.assign({
      courier: { ...COURIER, courierChainId: 'chain-x' },
      orderPharmacyChainId: 'chain-x',
      now: NOW,
    })
    expect(assignment.status).toBe('assigned')
  })

  it('SRS-DOM-037: курьер чужой сети → CourierTenantMismatchError', () => {
    const assignment = freshAssignment()
    expect(() => { assignment.assign({
        courier: { ...COURIER, courierChainId: 'chain-y' },
        orderPharmacyChainId: 'chain-x',
        now: NOW,
      }); },
    ).toThrow(CourierTenantMismatchError)
  })

  it('SRS-DOM-038: requiresColdChain=true, courier не сертифицирован → CourierNotEligibleError', () => {
    const assignment = freshAssignment(true)
    expect(() => { assignment.assign({ courier: COURIER, orderPharmacyChainId: null, now: NOW }); }).toThrow(
      CourierNotEligibleError,
    )
  })

  it('requiresColdChain=true, courier сертифицирован — успешно', () => {
    const assignment = freshAssignment(true)
    assignment.assign({ courier: { ...COURIER, coldChainCertified: true }, orderPharmacyChainId: null, now: NOW })
    expect(assignment.status).toBe('assigned')
  })

  it('повторный assign() из assigned → ForbiddenTransitionError (не unassigned)', () => {
    const assignment = freshAssignment()
    assignment.assign({ courier: COURIER, orderPharmacyChainId: null, now: NOW })
    expect(() => { assignment.assign({ courier: COURIER, orderPharmacyChainId: null, now: NOW }); }).toThrow(
      ForbiddenTransitionError,
    )
  })
})

describe('depart() — DoD тикета: явная отклонённая попытка из unassigned', () => {
  it('assigned → en_route_to_pharmacy — успешно', () => {
    const assignment = freshAssignment()
    assignment.assign({ courier: COURIER, orderPharmacyChainId: null, now: NOW })
    assignment.depart()
    expect(assignment.status).toBe('en_route_to_pharmacy')
  })

  it('depart() из unassigned (курьер не назначен) → ForbiddenTransitionError', () => {
    const assignment = freshAssignment()
    expect(() => { assignment.depart(); }).toThrow(ForbiddenTransitionError)
  })
})

/** Собирает `DeliveryAssignment` в произвольном нетерминальном статусе, проходя реальные переходы —
 * тот же приём, что `orderAtStatus` в `order.entity.spec.ts`, но без `restore()`-обхода (нет
 * причин обходить: путь короткий, дешевле пройти по-настоящему и проверить сцепку методов). */
function assignmentAtStatus(
  status: 'assigned' | 'en_route_to_pharmacy' | 'picked_up_from_pharmacy' | 'en_route_to_customer',
  requiresColdChain = false,
): DeliveryAssignment {
  const assignment = freshAssignment(requiresColdChain)
  assignment.assign({
    courier: requiresColdChain ? { ...COURIER, coldChainCertified: true } : COURIER,
    orderPharmacyChainId: null,
    now: NOW,
  })
  if (status === 'assigned') return assignment
  assignment.depart()
  if (status === 'en_route_to_pharmacy') return assignment
  assignment.markPickedUpFromPharmacy(NOW)
  if (status === 'picked_up_from_pharmacy') return assignment
  assignment.departToCustomer(requiresColdChain, NOW)
  return assignment
}

describe('markPickedUpFromPharmacy() (SRS-DOM-140)', () => {
  it('en_route_to_pharmacy → picked_up_from_pharmacy', () => {
    const assignment = assignmentAtStatus('en_route_to_pharmacy')
    assignment.markPickedUpFromPharmacy(NOW)
    expect(assignment.status).toBe('picked_up_from_pharmacy')
  })

  it('из assigned (минуя en_route_to_pharmacy) → ForbiddenTransitionError', () => {
    const assignment = assignmentAtStatus('assigned')
    expect(() => { assignment.markPickedUpFromPharmacy(NOW); }).toThrow(ForbiddenTransitionError)
  })
})

describe('departToCustomer() (SRS-DELIV-020)', () => {
  it('requiresColdChain=false — успешно без подтверждения', () => {
    const assignment = assignmentAtStatus('picked_up_from_pharmacy')
    assignment.departToCustomer(false, NOW)
    expect(assignment.status).toBe('en_route_to_customer')
  })

  it('requiresColdChain=true, coldChainBagConfirmed=false → ColdChainBagNotConfirmedError', () => {
    const assignment = assignmentAtStatus('picked_up_from_pharmacy', true)
    expect(() => { assignment.departToCustomer(false, NOW); }).toThrow(ColdChainBagNotConfirmedError)
  })

  it('requiresColdChain=true, coldChainBagConfirmed=true — успешно', () => {
    const assignment = assignmentAtStatus('picked_up_from_pharmacy', true)
    assignment.departToCustomer(true, NOW)
    expect(assignment.status).toBe('en_route_to_customer')
  })
})

describe('recordCash() (SRS-DOM-040/SRS-DELIV-021)', () => {
  it('collected - change === orderTotal — записывает без ошибки', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    expect(() => { assignment.recordCash(Money.fromDiram(6000n), Money.fromDiram(0n), Money.fromDiram(6000n)); },
    ).not.toThrow()
  })

  it('collected - change !== orderTotal (TC-DELIV-011: 6000-500 != 6000) → CashAmountMismatchError', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    expect(() => { assignment.recordCash(Money.fromDiram(6000n), Money.fromDiram(500n), Money.fromDiram(6000n)); },
    ).toThrow(CashAmountMismatchError)
  })
})

describe('markDelivered() (SRS-DOM-039/142, TC-DELIV-012/013)', () => {
  it('en_route_to_customer → delivered, non-cash — успешно без recordCash', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    assignment.markDelivered(LATER, false)
    expect(assignment.status).toBe('delivered')
  })

  it('TC-DELIV-012: cash_courier, recordCash НЕ вызван → CashAmountMismatchError (предусловие)', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    expect(() => { assignment.markDelivered(LATER, true); }).toThrow(CashAmountMismatchError)
  })

  it('TC-DELIV-013: cash_courier, recordCash вызван → markDelivered успешен', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    assignment.recordCash(Money.fromDiram(6000n), Money.fromDiram(0n), Money.fromDiram(6000n))
    assignment.markDelivered(LATER, true)
    expect(assignment.status).toBe('delivered')
  })

  it('delivered терминален — повторный markDelivered() → ForbiddenTransitionError', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    assignment.markDelivered(LATER, false)
    expect(() => { assignment.markDelivered(LATER, false); }).toThrow(ForbiddenTransitionError)
  })
})

describe('markFailed() (SRS-DOM-143, TC-DELIV-015) — эмитирует DeliveryFailedEvent', () => {
  it('en_route_to_customer → delivery_failed, событие с contactAttemptsCount', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    assignment.recordContactAttempt(NOW)
    assignment.recordContactAttempt(NOW)
    assignment.markFailed('customer_unreachable', LATER)
    expect(assignment.status).toBe('delivery_failed')
    const events = assignment.pullDomainEvents()
    expect(events).toEqual([
      { type: 'DeliveryFailedEvent', deliveryAssignmentId: 'assignment-1', orderId: ORDER_ID, reason: 'customer_unreachable', contactAttemptsCount: 2 },
    ])
  })
})

describe('reassign() — SRS-DOM-041/SRS-DELIV-034 (bespoke-guard)', () => {
  it('из assigned — успешно, сбрасывает прогресс и пишет reassignReason/reassignedBy', () => {
    const assignment = assignmentAtStatus('assigned')
    assignment.reassign({ newCourierId: 'courier-2', reason: 'SLA breach', reassignedBy: 'dispatcher-1', now: LATER })
    expect(assignment.status).toBe('assigned')
    expect(assignment.courierId).toBe('courier-2')
    expect(assignment.toSnapshot().reassignReason).toBe('SLA breach')
    expect(assignment.toSnapshot().reassignedBy).toBe('dispatcher-1')
  })

  it('из picked_up_from_pharmacy — успешно, сбрасывает pickedUpFromPharmacyAt', () => {
    const assignment = assignmentAtStatus('picked_up_from_pharmacy')
    assignment.reassign({ newCourierId: 'courier-2', reason: 'lost', reassignedBy: 'dispatcher-1', now: LATER })
    expect(assignment.toSnapshot().pickedUpFromPharmacyAt).toBeNull()
  })

  it('из en_route_to_customer — успешно', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    assignment.reassign({ newCourierId: 'courier-2', reason: 'lost', reassignedBy: 'dispatcher-1', now: LATER })
    expect(assignment.status).toBe('assigned')
  })

  it('из unassigned (нечего переназначать) → ForbiddenTransitionError', () => {
    const assignment = freshAssignment()
    expect(() => { assignment.reassign({ newCourierId: 'courier-2', reason: 'x', reassignedBy: 'dispatcher-1', now: NOW }); },
    ).toThrow(ForbiddenTransitionError)
  })

  it('после delivered (терминально) → ForbiddenTransitionError', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    assignment.markDelivered(LATER, false)
    expect(() => { assignment.reassign({ newCourierId: 'courier-2', reason: 'x', reassignedBy: 'dispatcher-1', now: LATER }); },
    ).toThrow(ForbiddenTransitionError)
  })

  it('reason пустая строка → ValidationError (обязателен, в отличие от assign-manual)', () => {
    const assignment = assignmentAtStatus('assigned')
    expect(() => { assignment.reassign({ newCourierId: 'courier-2', reason: '   ', reassignedBy: 'dispatcher-1', now: LATER }); },
    ).toThrow(ValidationError)
  })
})

describe('setDistanceSnapshot()/setHandoverOtp() — D.2/базовые поля', () => {
  it('записывают distanceMeters/handoverOtpId в снимок', () => {
    const assignment = freshAssignment()
    assignment.setDistanceSnapshot(1840)
    assignment.setHandoverOtp('otp-1')
    const snapshot = assignment.toSnapshot()
    expect(snapshot.distanceMeters).toBe(1840)
    expect(snapshot.handoverOtpId).toBe('otp-1')
  })
})

describe('restore()/toSnapshot() — round-trip', () => {
  it('снимок восстановленной сущности равен исходному', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    const snapshot = assignment.toSnapshot()
    const restored = DeliveryAssignment.restore(snapshot)
    expect(restored.toSnapshot()).toEqual(snapshot)
  })
})

describe('pullDomainEvents() — накапливает и очищает', () => {
  it('второй вызов подряд возвращает пустой массив', () => {
    const assignment = assignmentAtStatus('en_route_to_customer')
    assignment.markFailed('customer_unreachable', LATER)
    expect(assignment.pullDomainEvents()).toHaveLength(1)
    expect(assignment.pullDomainEvents()).toEqual([])
  })
})
