/**
 * Публичный фасад модуля `onboarding` (EP-03, DTJ-063, наполняется в DTJ-070).
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2: единственный легальный путь
 * межмодульного взаимодействия. Импорт
 * `modules/onboarding/domain|application|infrastructure|presentation` напрямую
 * — блокирующее нарушение.
 *
 * На этом шаге экспортируется ТОЛЬКО: доменные типы (для use case'ов
 * других модулей) и канонические ошибки. Остальные экспорты добавляются
 * строками по мере готовности (D-27).
 */

// Доменные классы и value-объекты (для сигнатур use case'ов других модулей).
export { PharmacyChain, type PharmacyChainCreateCommand, type PharmacyChainProps } from './domain/pharmacy-chain.entity.js'
export {
  PharmacyAccount,
  type PharmacyAccountCreateCommand,
  type PharmacyAccountProps,
  type PharmacySuspensionReason,
  PHARMACY_SUSPENSION_REASONS,
  PHARMACY_SUSPENSION_REASONS_REQUIRING_FORCE_CANCEL,
} from './domain/pharmacy-account.entity.js'
export {
  type OnboardingStatus,
  ONBOARDING_STATUS_VALUES,
  CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE,
  isTransitionAllowed,
  isOnboardingStatus,
} from './domain/value-objects/onboarding-status.vo.js'

// Доменные ошибки (для маппинга вызывающей стороной).
export { ParentChainNotActiveError } from './domain/errors/parent-chain-not-active.error.js'
export { ChainApplicationAlreadyExistsError } from './domain/errors/chain-application-already-exists.error.js'
export { AlreadyReviewedError } from './domain/errors/already-reviewed.error.js'
export { AutomaticReactivationForbiddenError } from './domain/errors/automatic-reactivation-forbidden.error.js'

// Публичный Facade модуля (DTJ-070). Единственный легальный способ для других
// модулей (EP-02 tenancy, EP-09 checkout) узнать статус аптеки/сети.
export { OnboardingFacade } from './onboarding.facade.js'
