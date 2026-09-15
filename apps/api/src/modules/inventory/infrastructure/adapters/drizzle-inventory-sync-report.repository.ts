/**
 * `DrizzleInventorySyncReportRepository` (EP-05, DTJ-163/164) — read-side запросы отчёта
 * кабинета аптеки: курсорный список батчей (SRS-INV-043), построчные ошибки + сырые данные
 * строки (SRS-INV-044), батчи одной Excel-загрузки (SRS-INV-045), узкий lookup `chain_id`
 * аптеки для проверки владения (SRS-API-046-style — «чужой батч → 404»).
 *
 * Вынесено ОТДЕЛЬНЫМ классом от `DrizzleInventorySyncBatchRepository` (который его вызывает
 * делегированием, тот же приём, что `errorsRepository` — см. её JSDoc), чтобы не раздувать и
 * без того превышающий C2 (≤300 строк) файл ещё на 4 read-метода с JOIN'ами.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gt, lt, or } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { inventorySyncBatch } from '@/db/schema/inventory-sync-batch.js'
import { inventorySyncErrors } from '@/db/schema/inventory-sync-errors.js'
import { inventorySyncRawItems } from '@/db/schema/inventory-sync-raw-items.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import type { InventorySyncBatchSnapshot } from '@/modules/inventory/domain/inventory-sync-batch.entity.js'
import type {
  InventoryRowErrorDetail,
  InventorySyncRowErrorCode,
} from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import { rowToInventorySyncBatchSnapshot } from './inventory-sync-batch-row.mapper.js'

const MIN_TOTAL_ROWS_FOR_REPORT = 0

export interface ReportScopeInput {
  readonly pharmacyId: string | null
  readonly chainId: string | null
  readonly cursor: { readonly v: string; readonly id: string } | null
  readonly limit: number
}

@Injectable()
export class DrizzleInventorySyncReportRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findPharmacyChainId(pharmacyId: string): Promise<string | null> {
    const rows = await this.db
      .select({ chainId: pharmacies.chainId })
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1)
    return rows[0]?.chainId ?? null
  }

  /** См. JSDoc порта `findManyForReport` — keyset-пагинация, синтетические контейнеры исключены. */
  async findManyForReport(
    input: ReportScopeInput,
  ): Promise<{ readonly items: readonly InventorySyncBatchSnapshot[]; readonly hasMore: boolean }> {
    const fetchLimit = input.limit + 1
    const rows =
      input.chainId !== null
        ? await this.selectByChain(input, fetchLimit)
        : await this.selectByPharmacyOrAny(input, fetchLimit)
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    return { items: page.map(rowToInventorySyncBatchSnapshot), hasMore }
  }

  private async selectByChain(input: ReportScopeInput, fetchLimit: number) {
    const joined = await this.db
      .select({ batch: inventorySyncBatch })
      .from(inventorySyncBatch)
      .innerJoin(pharmacies, eq(inventorySyncBatch.pharmacyId, pharmacies.id))
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guard в findManyForReport гарантирует chainId !== null на этом пути
      .where(and(eq(pharmacies.chainId, input.chainId!), ...this.buildCommonConditions(input)))
      .orderBy(desc(inventorySyncBatch.receivedAt), desc(inventorySyncBatch.id))
      .limit(fetchLimit)
    return joined.map((row) => row.batch)
  }

  private async selectByPharmacyOrAny(input: ReportScopeInput, fetchLimit: number) {
    const conditions = this.buildCommonConditions(input)
    if (input.pharmacyId !== null) {
      conditions.push(eq(inventorySyncBatch.pharmacyId, input.pharmacyId))
    }
    return this.db
      .select()
      .from(inventorySyncBatch)
      .where(and(...conditions))
      .orderBy(desc(inventorySyncBatch.receivedAt), desc(inventorySyncBatch.id))
      .limit(fetchLimit)
  }

  /** `totalRows > 0` (исключает синтетические parser-errors контейнеры, DTJ-164) + keyset-курсор. */
  private buildCommonConditions(input: ReportScopeInput) {
    const conditions = [gt(inventorySyncBatch.totalRows, MIN_TOTAL_ROWS_FOR_REPORT)]
    if (input.cursor !== null) {
      const cursorDate = new Date(input.cursor.v)
      conditions.push(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- or()/and() из drizzle-orm типизированы как возможно undefined, но с непустыми аргументами всегда возвращают SQL
        or(
          lt(inventorySyncBatch.receivedAt, cursorDate),
          and(eq(inventorySyncBatch.receivedAt, cursorDate), lt(inventorySyncBatch.id, input.cursor.id)),
        )!,
      )
    }
    return conditions
  }

  /** См. JSDoc порта `findRowErrorsByBatchId` — LEFT JOIN на raw_items по `(batch_id, row_index)`. */
  async findRowErrorsByBatchId(batchId: string): Promise<readonly InventoryRowErrorDetail[]> {
    const rows = await this.db
      .select({
        rowIndex: inventorySyncErrors.rowIndex,
        errorCode: inventorySyncErrors.errorCode,
        reason: inventorySyncErrors.reason,
        rawRow: inventorySyncRawItems.payload,
      })
      .from(inventorySyncErrors)
      .leftJoin(
        inventorySyncRawItems,
        and(
          eq(inventorySyncRawItems.batchId, inventorySyncErrors.batchId),
          eq(inventorySyncRawItems.rowIndex, inventorySyncErrors.rowIndex),
        ),
      )
      .where(eq(inventorySyncErrors.batchId, batchId))
      .orderBy(asc(inventorySyncErrors.rowIndex))
    return rows.map((row) => ({
      rowIndex: row.rowIndex,
      errorCode: row.errorCode as InventorySyncRowErrorCode,
      reason: row.reason,
      rawRow: (row.rawRow as Readonly<Record<string, unknown>> | null) ?? null,
    }))
  }

  async findBySourceUploadId(sourceUploadId: string): Promise<readonly InventorySyncBatchSnapshot[]> {
    const rows = await this.db
      .select()
      .from(inventorySyncBatch)
      .where(eq(inventorySyncBatch.sourceUploadId, sourceUploadId))
      .orderBy(asc(inventorySyncBatch.pageNumber))
    return rows.map(rowToInventorySyncBatchSnapshot)
  }
}
