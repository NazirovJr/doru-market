// Публичный фасад модуля (см. index.ts). Порог устаревания — дефолт схемы
// tenant_settings.inventory_delta_sla_minutes; реальный per-tenant override требует tenantId
// аптеки (chain->tenant, чужой модуль) — вне бюджета, тот же fallback-приём, что уже
// использован для того же порога в поиске каталога (postgres-search.adapter.ts).
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  PHARMACY_INVENTORY_REPOSITORY,
  type PharmacyInventoryRepository,
} from './application/ports/pharmacy-inventory.repository.port.js'

const ASSUMED_INVENTORY_DELTA_SLA_MINUTES = 5
const MS_PER_MINUTE = 60_000
const PERCENT_MULTIPLIER = 100

export interface InventorySummary {
  readonly skuCount: number
  readonly staleDataSharePercent: number
}

@Injectable()
export class InventoryFacade {
  constructor(
    @Inject(PHARMACY_INVENTORY_REPOSITORY) private readonly repository: PharmacyInventoryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getInventorySummary(pharmacyId: string): Promise<InventorySummary> {
    const staleBefore = new Date(this.clock.now().getTime() - ASSUMED_INVENTORY_DELTA_SLA_MINUTES * MS_PER_MINUTE)
    const { skuCount, totalRowCount, staleRowCount } = await this.repository.getSummary({ pharmacyId, staleBefore })
    const staleDataSharePercent = totalRowCount === 0 ? 0 : Math.round((staleRowCount / totalRowCount) * PERCENT_MULTIPLIER)
    return { skuCount, staleDataSharePercent }
  }
}
