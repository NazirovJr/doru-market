/**
 * `GetTenantMetaUseCase` (DTJ-033) — SLA-пороги для `GET /tenant/meta` (`StaleDataBadge`, DTJ-169).
 * `inventoryManualStaleHours` — ДОПУЩЕНИЕ: колонки/ENV для него нет нигде (`grep INVENTORY_MANUAL_STALE`
 * пуст), `docs/spec/22-module-inventory-sync-1c.md` §7 сам фиксирует его как `ASSUMPTION 72`.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  TENANT_SETTINGS_REPOSITORY,
  type TenantSettingsRepositoryPort,
} from '@/modules/tenancy/application/ports/tenant-settings-repository.port.js'
import { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'

const INVENTORY_MANUAL_STALE_HOURS = 72
// Дефолт при отсутствии строки настроек у резолвленного тенанта — не должно происходить в норме.
const FALLBACK_INVENTORY_DELTA_SLA_MINUTES = 5

// presentation не трогает domain напрямую (`02` §6) — сюда приходит строка, VO строится здесь.
export interface GetTenantMetaCommand {
  readonly tenantId: string
}

export interface TenantMetaResult {
  readonly inventoryDeltaSlaMinutes: number
  readonly inventoryManualStaleHours: number
}

@Injectable()
export class GetTenantMetaUseCase {
  constructor(
    @Inject(TENANT_SETTINGS_REPOSITORY) private readonly tenantSettingsRepository: TenantSettingsRepositoryPort,
  ) {}

  async execute(command: GetTenantMetaCommand): Promise<TenantMetaResult> {
    const settings = await this.tenantSettingsRepository.findByTenantId(TenantId.from(command.tenantId))
    return {
      inventoryDeltaSlaMinutes: settings?.inventoryDeltaSlaMinutes ?? FALLBACK_INVENTORY_DELTA_SLA_MINUTES,
      inventoryManualStaleHours: INVENTORY_MANUAL_STALE_HOURS,
    }
  }
}
