import { Inject, Injectable } from '@nestjs/common'
import { OnboardingFacade } from '@/modules/onboarding/index.js'
import { InventoryFacade } from '@/modules/inventory/index.js'
import {
  ANALYTICS_INVENTORY_FACADE_PORT,
  type InventoryFacadePort,
} from '@/modules/analytics/application/ports/inventory-facade.port.js'

const RECENT_ACTIVITY_WINDOW_DAYS = 7
const MS_PER_DAY = 86_400_000

@Injectable()
export class InventoryFacadeAdapter implements InventoryFacadePort {
  constructor(
    @Inject(OnboardingFacade) private readonly onboarding: OnboardingFacade,
    @Inject(InventoryFacade) private readonly inventory: InventoryFacade,
  ) {}

  async getActivePharmaciesSendingDataRate(tenantId: string): Promise<number> {
    const activeIds = await this.onboarding.listActivePharmacyIds(tenantId)
    if (activeIds.length === 0) {
      return 0
    }
    const sinceDate = new Date(Date.now() - RECENT_ACTIVITY_WINDOW_DAYS * MS_PER_DAY)
    const sendingIds = await this.inventory.findPharmacyIdsWithRecentSyncActivity(activeIds, sinceDate)
    return sendingIds.size / activeIds.length
  }
}

export const INVENTORY_FACADE_PORT_PROVIDER = {
  provide: ANALYTICS_INVENTORY_FACADE_PORT,
  useClass: InventoryFacadeAdapter,
} as const
