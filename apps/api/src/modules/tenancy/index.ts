/**
 * Публичный барабан модуля `tenancy` (D-27). Экспортирует ТОЛЬКО: доменные типы
 * (для use case'ов других модулей), базовые классы для tenant-скоупных репозиториев
 * (DTJ-056, единственный публичный элемент инфраструктуры) и публичные порты
 * для cross-module использования (SecretsVaultPort, DTJ-058; TelegramTokenResolverPort,
 * DTJ-062; ChainEligibilityPort, DTJ-057).
 *
 * Прямой импорт внутренних файлов модуля из другого модуля — блокирующее
 * нарушение `02` §1.1. Импортируйте только из этого файла.
 *
 * ВАЖНО: на этом шаге (DTJ-050) экспортируется МИНИМУМ — только доменные классы.
 * Остальные экспорты добавляются строками по мере готовности соответствующих тикетов
 * (D-27: править ТОЛЬКО добавлением строки).
 */

// Доменные классы — публичный контракт (use case'ы других модулей могут принимать
// `Tenant`/`TenantId`/`TenantSlug` в командах).
export { Tenant } from './domain/tenant.entity.js'
export {
  TenantSettings,
  type TenantSettingsBrand,
  type TenantSettingsBrandingUpdate,
} from './domain/tenant-settings.entity.js'
export { TenantId } from './domain/value-objects/tenant-id.vo.js'
export { TenantSlug, RESERVED_SLUGS, type ReservedSlug } from './domain/value-objects/tenant-slug.vo.js'
export {
  CourierSourcingModeVO,
  COURIER_SOURCING_MODES,
  type CourierSourcingMode,
} from './domain/value-objects/courier-sourcing-mode.vo.js'
export {
  CustomDomainStatusVO,
  CUSTOM_DOMAIN_STATUSES,
  type CustomDomainStatus,
} from './domain/value-objects/custom-domain-status.vo.js'

// DTJ-056 — базовый класс тенант-скоупных репозиториев и переиспользуемый
// контракт-тест на изоляцию тенантов. ЕДИНСТВЕННЫЙ разрешённый прямой экспорт
// из `infrastructure/` — используется другими модулями через `@/modules/tenancy`.
export {
  TenantScopedRepository,
  InvalidTenantIdError,
} from './infrastructure/base/tenant-scoped-repository.js'
export {
  describeTenantIsolationContract,
  type TenantIsolationContractOptions,
} from './testing/tenant-isolation.contract-test.js'
