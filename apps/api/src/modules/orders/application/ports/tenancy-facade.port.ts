/**
 * Порт `TenancyFacadePort` (EP-09, DTJ-220, SRS-ORD-018 шаг 4d, SRS-DOM-160, D-03).
 *
 * Межмодульный фасад `orders → tenancy` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2). Вызывается
 * НА КАЖДУЮ позицию группы checkout (SRS-ORD-018 шаг 4d) — резолвит ставку комиссии платформы
 * по специфичности (тенант → сеть → категория → глобальный дефолт, D-03) и снэпшотится
 * НЕИЗМЕНЯЕМО в `order_items.commission_bps`/`platform_fee_diram` (SRS-DOM-008): последующее
 * изменение ставки в конфигурации не влияет на уже созданные позиции.
 *
 * Реализация — адаптер поверх публичного фасада `modules/tenancy/index.ts`, заводится
 * потребляющим тикетом (`CheckoutUseCase`, DTJ-227/228). Здесь — ТОЛЬКО контракт (DTJ-220,
 * скаффолдинг).
 *
 * РАСШИРЕНИЕ (DTJ-229, «Что сделать» п.2/3): `getCodLimitDiram`/`getEnabledPaymentMethods`
 * добавлены этим тикетом — `CodPolicyService`/`PaymentMethodEnabledPolicyService` читают
 * настройки тенанта ИМЕННО через `orders → tenancy` фасад (тот же межмодульный порт, что
 * `resolveCommissionRate`), а не заводят второй одноимённый порт. `cod_limit_diram` УЖЕ есть в
 * базовой схеме `tenant_settings` (D-EP09-5) — читается по-настоящему, не хардкодится.
 * `enabledPaymentMethods` — колонки `tenant_settings.enabled_payment_methods` НЕТ (Group C, не
 * моё владение) — R1 сознательно фиксирует константу (D-EP09-16: заглушка на вопрос
 * «разрешено ли» обязана бросать ИЛИ быть явным продуктовым решением, не «true для всех»; здесь
 * — второе, зафиксировано `TODO` на будущую миграцию Group C).
 */
import type { OrderPaymentMethod } from '@dorutj/contracts'

/** DI-токен для провайдера `TenancyFacadePort`. */
export const TENANCY_FACADE_PORT = Symbol.for('@dorutj/orders/tenancy-facade')

/**
 * Грубая группировка категории для резолвинга комиссии (`categories.commission_category`,
 * CHECK `chk_categories_commission_category` — `db/schema/categories.ts`), НЕ дерево навигации
 * каталога (SRS-CAT-003).
 */
export type CommissionCategory = 'rx' | 'otc' | 'parapharma'

export interface TenancyFacadePort {
  /**
   * Ставка комиссии платформы в basis points (500 = 5%, диапазон 0..10000, SRS-DOM-160).
   * `chainId` — `null` для независимой аптеки/нейтрального тенанта (резолвинг падает на
   * уровень тенанта/глобальный дефолт).
   */
  resolveCommissionRate(
    tenantId: string,
    chainId: string | null,
    category: CommissionCategory,
  ): Promise<number>

  /** `tenant_settings.cod_limit_diram` (DTJ-229, D-EP09-5) — лимит COD в целых дирамах. */
  getCodLimitDiram(tenantId: string): Promise<bigint>

  /**
   * Способы оплаты, разрешённые тенанту (DTJ-229, SRS-ORD-025 п.2). R1: константный список
   * (см. JSDoc файла) — колонки `tenant_settings.enabled_payment_methods` физически нет.
   */
  getEnabledPaymentMethods(tenantId: string): Promise<readonly OrderPaymentMethod[]>

  /**
   * DTJ-301 (EP-12, SRS-PHT-008/030, D-19) — `tenant_settings.pickup_sla_minutes` (дефолт 7
   * минут), читает `AcceptOrderUseCase` для `slaDeadlineAt = now + pickupSlaMinutes`.
   */
  getPickupSlaMinutes(tenantId: string): Promise<number>

  /**
   * DTJ-304 (EP-12 §A.4, SRS-PHT-019/073) — `tenant_settings.partial_fulfillment_confirmation_
   * timeout_minutes` (DB-дефолт 10, миграция `0041_pharmacy_terminal_schema.sql`, DTJ-300),
   * читает `ProposePartialFulfillmentUseCase` для `expiresAt = now + <это значение>` и
   * планирования BullMQ delayed job того же таймаута. Кросс-констрейнт с `pickupSlaMinutes` +
   * `pickupSlaBufferMinutes` (SRS-PHT-073) НЕ проверяется — см. «Риски» тикета DTJ-304.
   */
  getPartialFulfillmentConfirmationTimeoutMinutes(tenantId: string): Promise<number>

  /**
   * DTJ-306 (EP-12 §A.5, SRS-PHT-028) — `tenant_settings.handover_otp_max_regenerations_per_order`
   * (DB-дефолт 20, см. `db/schema/tenants.ts`), используется в `RegenerateHandoverOtpUseCase`.
   */
  getHandoverOtpMaxRegenerationsPerOrder(tenantId: string): Promise<number>

  /**
   * DTJ-306 (EP-12 §A.5, SRS-PHT-028) — `tenant_settings.handover_otp_regenerate_min_interval_seconds`
   * (DB-дефолт 60, см. `db/schema/tenants.ts`), используется в `RegenerateHandoverOtpUseCase`.
   */
  getHandoverOtpRegenerateMinIntervalSeconds(tenantId: string): Promise<number>
}
