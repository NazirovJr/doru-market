/**
 * `DrizzleReturnsTenantSettingsAdapter` (EP-11, DTJ-273) — реализация `ReturnsTenantSettingsPort`
 * поверх `TenantSettingsRepositoryPort` публичного фасада `modules/tenancy` (EP-01/02, НЕ стаб —
 * `dispute_window_hours`/`return_restock_min_remaining_days` уже существуют в базовой схеме,
 * 1:1 приём, что `TenancyFacadeAdapter.getCodLimitDiram` в `orders` DTJ-229).
 *
 * Дефолты — 1:1 с DB-дефолтами колонок (`db/schema/tenants.ts`), используются ТОЛЬКО если строка
 * `tenant_settings` отсутствует (не должно происходить в норме, EP-02 создаёт её атомарно с тенантом).
 */
import { Inject, Injectable } from '@nestjs/common'
import { TENANT_SETTINGS_REPOSITORY, TenantId, type TenantSettingsRepositoryPort } from '@/modules/tenancy/index.js'
import type { ReturnsTenantSettingsPort } from '@/modules/returns/application/ports/returns-tenant-settings.port.js'
import { RETURNS_TENANT_SETTINGS_PORT } from '@/modules/returns/application/ports/returns-tenant-settings.port.js'

const DEFAULT_DISPUTE_WINDOW_HOURS = 24
const DEFAULT_RETURN_RESTOCK_MIN_REMAINING_DAYS = 30

@Injectable()
export class DrizzleReturnsTenantSettingsAdapter implements ReturnsTenantSettingsPort {
  public constructor(
    @Inject(TENANT_SETTINGS_REPOSITORY) private readonly tenantSettingsRepository: TenantSettingsRepositoryPort,
  ) {}

  public async getDisputeWindowHours(tenantId: string): Promise<number> {
    const settings = await this.tenantSettingsRepository.findByTenantId(TenantId.from(tenantId))
    return settings?.disputeWindowHours ?? DEFAULT_DISPUTE_WINDOW_HOURS
  }

  public async getReturnRestockMinRemainingDays(tenantId: string): Promise<number> {
    const settings = await this.tenantSettingsRepository.findByTenantId(TenantId.from(tenantId))
    return settings?.returnRestockMinRemainingDays ?? DEFAULT_RETURN_RESTOCK_MIN_REMAINING_DAYS
  }
}

export const RETURNS_TENANT_SETTINGS_DRIZZLE_PROVIDER = {
  provide: RETURNS_TENANT_SETTINGS_PORT,
  useClass: DrizzleReturnsTenantSettingsAdapter,
} as const
