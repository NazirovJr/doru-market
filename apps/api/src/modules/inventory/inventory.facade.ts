// Первый публичный фасад модуля inventory — минимален, расширяется по мере чужих потребностей.
import { Inject, Injectable } from '@nestjs/common'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from './application/ports/inventory-sync-batch.repository.port.js'

@Injectable()
export class InventoryFacade {
  constructor(
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY) private readonly syncBatchRepository: InventorySyncBatchRepository,
  ) {}

  async findPharmacyIdsWithRecentSyncActivity(
    pharmacyIds: readonly string[],
    sinceDate: Date,
  ): Promise<ReadonlySet<string>> {
    const ids = await this.syncBatchRepository.findPharmacyIdsWithActivitySince(pharmacyIds, sinceDate)
    return new Set(ids)
  }
}
