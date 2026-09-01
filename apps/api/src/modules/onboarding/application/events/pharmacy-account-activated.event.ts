/**
 * `PharmacyAccountActivatedEvent` (DTJ-068) — зеркало `PharmacyChainActivatedEvent`
 * для дочерней аптечной точки.
 */
export interface PharmacyAccountActivatedEvent {
  readonly type: 'PharmacyAccountActivated'
  readonly pharmacyId: string
  readonly chainId: string
  readonly approvedBy: string
  readonly approvedAt: Date
}

export const PHARMACY_ACCOUNT_ACTIVATED_EVENT = Symbol.for('@dorutj/onboarding/pharmacy-account-activated')

export const pharmacyAccountActivatedEventType = 'PharmacyAccountActivated' as const
