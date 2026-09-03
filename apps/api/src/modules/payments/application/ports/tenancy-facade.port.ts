/**
 * Порт `PaymentsTenancyPort` (EP-10, DTJ-236, `21-module-orders-payments-escrow.md` §6.1,
 * §«Дополнения к схеме БД»).
 *
 * Межмодульный фасад `payments → tenancy` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) —
 * тонкая обёртка над публичным фасадом `modules/tenancy/index.ts` (реализация — адаптер
 * `infrastructure/adapters/tenancy-facade.adapter.ts`, заводится потребляющим тикетом,
 * начиная с DTJ-249/253: `PayoutSchedulerJob`/B2B-биллинг наличной комиссии читают
 * `holdPeriodDays`/`enabledPaymentMethods` отсюда, не хардкодят).
 *
 * `tenantId` — первый и единственный обязательный параметр (правило 3 задания, SRS-API-043).
 *
 * СТАТУС КОЛОНОК (честно, не домыслено): `holdPeriodDays` backed реальной колонкой
 * `tenant_settings.hold_period_days` (существует с `0002_tenants_and_settings.sql`, EP-02).
 * `enabledPaymentMethods`/`useSplitBilling`/`disputeAutoRefundThresholdDiram`/
 * `disputeResolutionSlaHours` соответствуют полям из §«Дополнения к схеме БД» этого документа
 * — колонок `tenant_settings.enabled_payment_methods` и т.п. в схеме ЕЩЁ НЕТ (тот же
 * задокументированный гэп, что `modules/orders/application/ports/tenancy-facade.port.ts`
 * зафиксировал для `getEnabledPaymentMethods` при DTJ-229: «R1 сознательно фиксирует
 * константу... ADR требуется перед миграцией»). Порт объявляет их уже сейчас (форма контракта
 * не меняется при появлении реальных колонок), реализация — на усмотрение адаптера DTJ-249/253.
 */

/** DI-токен для провайдера `PaymentsTenancyPort`. */
export const PAYMENTS_TENANCY_PORT = Symbol.for('@dorutj/payments/tenancy-facade')

export interface PaymentsTenantSettings {
  readonly tenantId: string
  /** T+1 расписание payout (SRS-PAY-030) — снэпшотится в `payout_schedule.hold_period_days`. */
  readonly holdPeriodDays: number
  /** SRS-ORD-025 п.2 — см. ГЭП в JSDoc файла (колонки пока нет, ADR не проведён). */
  readonly enabledPaymentMethods: readonly string[]
  /** D-10, §7.5 — раздельный биллинг items/delivery. См. ГЭП в JSDoc файла. */
  readonly useSplitBilling: boolean
  /** SRS-DISP-005 — порог самостоятельного полного рефанда `support_agent` без эскалации. */
  readonly disputeAutoRefundThresholdDiram: bigint
  /** SRS-DISP-006 — SLA на разрешение уже открытого спора (часы). */
  readonly disputeResolutionSlaHours: number
}

export interface PaymentsTenancyPort {
  getTenantSettings(tenantId: string): Promise<PaymentsTenantSettings>
}
