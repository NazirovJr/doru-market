/**
 * `PharmacyChainActivatedEvent` (DTJ-068) — domain-событие, публикуется при
 * `approve` заявки сети. Слушатель (тот же модуль, EP-05 каталог) проверяет
 * наличие дочерних `active` точек и при необходимости переводит сеть в `active`.
 *
 * На момент DTJ-068 публикация — noop (outbox-инфраструктура EP-01 не стабилизирована).
 * `publish` записывает событие в outbox-таблицу `outbox` через `unitOfWork.run`.
 */
export interface PharmacyChainActivatedEvent {
  readonly type: 'PharmacyChainActivated'
  readonly chainId: string
  readonly approvedBy: string
  readonly approvedAt: Date
}

export const PHARMACY_CHAIN_ACTIVATED_EVENT = Symbol.for('@dorutj/onboarding/pharmacy-chain-activated')

export const pharmacyChainActivatedEventType = 'PharmacyChainActivated' as const
