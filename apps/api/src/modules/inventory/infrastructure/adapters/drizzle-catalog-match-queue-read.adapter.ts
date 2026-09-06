/**
 * Drizzle-реализация `CatalogMatchQueueReadPort` (EP-05, DTJ-163) — см. JSDoc порта.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, count, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { catalogMatchQueue } from '@/db/schema/catalog-match-queue.js'
import { CATALOG_MATCH_QUEUE_READ, type CatalogMatchQueueReadPort } from '@/modules/inventory/application/ports/catalog-match-queue-read.port.js'

@Injectable()
export class DrizzleCatalogMatchQueueReadAdapter implements CatalogMatchQueueReadPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async countPending(pharmacyId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(catalogMatchQueue)
      .where(and(eq(catalogMatchQueue.pharmacyId, pharmacyId), eq(catalogMatchQueue.status, 'pending')))
    return rows[0]?.value ?? 0
  }
}

export const CATALOG_MATCH_QUEUE_READ_DRIZZLE_PROVIDER = {
  provide: CATALOG_MATCH_QUEUE_READ,
  useClass: DrizzleCatalogMatchQueueReadAdapter,
} as const
