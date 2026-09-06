/**
 * `InventorySyncBatchRow → InventorySyncBatchSnapshot` (EP-05, DTJ-163). Вынесено из
 * `DrizzleInventorySyncBatchRepository` (второй потребитель — `DrizzleInventorySyncReportRepository`,
 * C15/DRY — тот же приём, что `order-row.mapper.ts`, вынесенный из `order.repository.ts`).
 */
import type { InventorySyncBatchRow } from '@/db/schema/inventory-sync-batch.js'
import type {
  BatchStatus,
  InventorySyncBatchSnapshot,
  SyncType,
} from '@/modules/inventory/domain/inventory-sync-batch.entity.js'
import type { InventorySyncChannel } from '@/modules/inventory/domain/inventory-sync.types.js'

export function rowToInventorySyncBatchSnapshot(row: InventorySyncBatchRow): InventorySyncBatchSnapshot {
  return {
    id: row.id,
    pharmacyId: row.pharmacyId,
    channel: row.channel as InventorySyncChannel,
    syncType: row.syncType as SyncType,
    status: row.status as BatchStatus,
    totalRows: row.totalRows,
    acceptedRows: row.acceptedRows,
    rejectedRows: row.rejectedRows,
    fullSyncSessionId: row.fullSyncSessionId,
    pageNumber: row.pageNumber,
    isLastPage: row.isLastPage,
    receivedAt: row.receivedAt,
    completedAt: row.finishedAt,
    errorSummary: row.errorSummary as readonly { readonly rowIndex: number; readonly reason: string }[] | null,
    note: row.note,
    sourceUploadId: row.sourceUploadId,
  }
}
