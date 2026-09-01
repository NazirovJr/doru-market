/**
 * `OnboardingStatus` — единый TS-тип для состояний жизненного цикла
 * `PharmacyChain` и `PharmacyAccount` (SRS-DOM-047..050, Группа A
 * `11-database-schema.md` §172–177 — два PG-ENUM с ИДЕНТИЧНЫМ набором
 * значений, общий TS-тип, не два параллельных).
 *
 * Граф переходов (REQ-ONBOARD-8, `isTransitionAllowed` ниже) — единственный
 * источник допустимости перехода. Доменная ошибка `InvalidOnboardingTransitionError`
 * (`packages/contracts`) бросается при попытке недопустимого перехода.
 *
 * Терминальные состояния: `rejected` (повторная подача переводит в `draft`,
 * DTJ-064 п.3), `terminated` (НАВСЕГДА, без пути назад, REQ-ONBOARD-12,
 * SRS-ADM-011).
 */
import { InvalidOnboardingTransitionError } from '@dorutj/contracts'

export const ONBOARDING_STATUS_VALUES = [
  'draft',
  'pending_review',
  'changes_requested',
  'approved',
  'active',
  'rejected',
  'suspended',
  'terminated',
] as const

export type OnboardingStatus = (typeof ONBOARDING_STATUS_VALUES)[number]

/** Допустимые статусы родительской сети для `PharmacyAccount.activate()` (SRS-DOM-048). */
export const CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE = ['approved', 'active'] as const

/**
 * Граф переходов (REQ-ONBOARD-8/9/11, SRS-DOM-050, SRS-ADM-011/019):
 *
 *   draft → pending_review → changes_requested ↔ pending_review
 *         → approved → active → suspended → pending_review [reactivation]
 *         → rejected (терминально, но DTJ-064 п.3 переиспользует заявку
 *           rejected → draft при повторной подаче — это операция
 *           SubmitChainApplicationUseCase, не доменный переход цепочки)
 *         → terminated (терминально НАВСЕГДА)
 *         * → terminated (из ЛЮБОГО состояния, по решению super_admin)
 */
const ALLOWED_TRANSITIONS: Readonly<Record<OnboardingStatus, readonly OnboardingStatus[]>> = {
  draft: ['pending_review', 'terminated'],
  pending_review: ['changes_requested', 'approved', 'rejected', 'terminated'],
  changes_requested: ['pending_review', 'rejected', 'terminated'],
  approved: ['active', 'terminated'],
  active: ['suspended', 'terminated'],
  suspended: ['pending_review', 'terminated'],
  rejected: [], // терминально (повторная подача обрабатывается use case'ом, не цепочкой)
  terminated: [], // терминально НАВСЕГДА
}

/**
 * Чистая функция проверки допустимости перехода `from → to`.
 * Используется ОБОИМИ сущностями (PharmacyChain, PharmacyAccount).
 */
export function isTransitionAllowed(from: OnboardingStatus, to: OnboardingStatus): boolean {
  if (from === to) {
    return false // Самопереход не считается валидным переходом
  }
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * Бросает `InvalidOnboardingTransitionError` если переход недопустим.
 * Используется доменными методами сущностей.
 */
export function assertTransitionAllowed(from: OnboardingStatus, to: OnboardingStatus): void {
  if (!isTransitionAllowed(from, to)) {
    throw new InvalidOnboardingTransitionError({
      from,
      to,
      reason: 'onboarding_state_machine',
    })
  }
}

/** Гард для VO-инициализации (парсинга из БД-строки). */
export function isOnboardingStatus(value: string): value is OnboardingStatus {
  return (ONBOARDING_STATUS_VALUES as readonly string[]).includes(value)
}
