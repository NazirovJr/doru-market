/**
 * `PaymentsTenancyAdapter` (EP-10, DTJ-244) — ПЕРВЫЙ реальный биндинг `PaymentsTenancyPort`
 * (DTJ-236 объявил порт, JSDoc: «реализация... заводится потребляющим тикетом, начиная с
 * DTJ-249/253» — ни один из них фактически не читал `holdPeriodDays`, `CaptureEscrowUseCase`
 * (DTJ-244) — первый реальный потребитель). Тот же приём, что `TenancyFacadeAdapter`
 * (`orders/infrastructure/adapters/tenancy-facade.adapter.ts`, DTJ-228/229): тонкая обёртка над
 * `TenantSettingsRepositoryPort` (`modules/tenancy/index.ts`).
 *
 * `holdPeriodDays` — РЕАЛЬНАЯ колонка `tenant_settings.hold_period_days` (см. JSDoc порта,
 * `tenancy-facade.port.ts`: «существует с 0002_tenants_and_settings.sql, EP-02»). Остальные
 * поля контракта (`enabledPaymentMethods`/`useSplitBilling`/`disputeAutoRefundThresholdDiram`/
 * `disputeResolutionSlaHours`) — ЗАДОКУМЕНТИРОВАННЫЙ ГЭП (та же формулировка, что JSDoc порта:
 * «колонок... в схеме ещё нет»), R1-константы-заглушки, СИМВОЛИЧНО СОГЛАСОВАННЫЕ с ТЕМИ ЖЕ
 * дефолтами, что `orders`-сторона (`DEFAULT_ENABLED_PAYMENT_METHODS`, `TenancyFacadeAdapter`) —
 * ни один текущий вызывающий код (`CaptureEscrowUseCase`) их не читает, но контракт порта
 * обязан быть удовлетворён целиком (не частичной заглушкой одного поля).
 */
import { Inject, Injectable } from '@nestjs/common'
import { TENANT_SETTINGS_REPOSITORY, TenantId, type TenantSettingsRepositoryPort } from '@/modules/tenancy/index.js'
import {
  PAYMENTS_TENANCY_PORT,
  type PaymentsTenancyPort,
  type PaymentsTenantSettings,
} from '@/modules/payments/application/ports/tenancy-facade.port.js'

/** R1 ASSUMPTION — см. JSDoc файла. Не читается ни одним текущим вызывающим кодом. */
const DEFAULT_ENABLED_PAYMENT_METHODS: readonly string[] = ['cash_courier']
const DEFAULT_USE_SPLIT_BILLING = false
const DEFAULT_DISPUTE_AUTO_REFUND_THRESHOLD_DIRAM = 0n
const DEFAULT_DISPUTE_RESOLUTION_SLA_HOURS = 72

@Injectable()
export class PaymentsTenancyAdapter implements PaymentsTenancyPort {
  public constructor(@Inject(TENANT_SETTINGS_REPOSITORY) private readonly repo: TenantSettingsRepositoryPort) {}

  public async getTenantSettings(tenantId: string): Promise<PaymentsTenantSettings> {
    const settings = await this.repo.findByTenantId(TenantId.from(tenantId))
    if (settings === null) {
      throw new Error(`PaymentsTenancyAdapter: tenant_settings not found for tenant ${tenantId}`)
    }
    return {
      tenantId,
      holdPeriodDays: settings.holdPeriodDays,
      enabledPaymentMethods: DEFAULT_ENABLED_PAYMENT_METHODS,
      useSplitBilling: DEFAULT_USE_SPLIT_BILLING,
      disputeAutoRefundThresholdDiram: DEFAULT_DISPUTE_AUTO_REFUND_THRESHOLD_DIRAM,
      disputeResolutionSlaHours: DEFAULT_DISPUTE_RESOLUTION_SLA_HOURS,
    }
  }
}

export const PAYMENTS_TENANCY_PORT_PROVIDER = {
  provide: PAYMENTS_TENANCY_PORT,
  useClass: PaymentsTenancyAdapter,
} as const
