/**
 * `InventorySyncReportQueryService` (EP-05, DTJ-158, растёт в DTJ-163/164).
 *
 * Тонкая read-only query-обёртка над `InventorySyncBatchRepository` — существует
 * ТОЛЬКО чтобы presentation НЕ касался `InventorySyncBatch`/домена напрямую
 * (`.dependency-cruiser.cjs`, правило `presentation-goes-through-application`: «Контроллер
 * не имеет права знать доменные инварианты напрямую — только через use case», §1.1).
 * Каждый метод возвращает ПЛОСКИЙ DTO этого же файла (application-слой), не
 * `InventorySyncBatch`/`InventorySyncBatchSnapshot` (те — domain-типы).
 *
 * Один класс на несколько read-эндпоинтов отчёта (DTJ-158/163/164) — по аналогии с
 * `DrizzleInventorySyncReportRepository` (infrastructure), который уже объединяет
 * их read-запросы; симметрично на application-уровне, не по одному микро-use-case
 * на тикет.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { BatchStatus, SyncType } from '../../domain/inventory-sync-batch.entity.js'
import type { InventorySyncChannel } from '../../domain/inventory-sync.types.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from '../ports/inventory-sync-batch.repository.port.js'

/** DTJ-158 `GET /inventory-sync-batches/:batchId` (SRS-INV-008). */
export interface InventorySyncBatchStatusResult {
  readonly batchId: string
  readonly status: BatchStatus
  readonly channel: InventorySyncChannel
  readonly syncType: SyncType
  readonly totalRows: number
  readonly acceptedRows: number
  readonly rejectedRows: number
  readonly receivedAt: Date
  readonly completedAt: Date | null
}

@Injectable()
export class InventorySyncReportQueryService {
  constructor(
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
  ) {}

  /**
   * DTJ-158: статус одного батча для принципала `pharmacy_system` (ключ 1С/ERP).
   * `null` — батч не найден ИЛИ не принадлежит принципалу (владелец решает
   * НЕ различать эти два случая в ответе — оба дают `404 NOT_FOUND`, SRS-API-046-style).
   */
  async getBatchStatusForPharmacySystemPrincipal(input: {
    readonly batchId: string
    readonly principalPharmacyId: string
    readonly principalChainId: string | null
  }): Promise<InventorySyncBatchStatusResult | null> {
    const batch = await this.syncBatchRepository.findById(input.batchId)
    if (batch === null) {
      return null
    }
    const owned = await this.isOwnedByPrincipal(
      batch.pharmacyId,
      input.principalPharmacyId,
      input.principalChainId,
    )
    if (!owned) {
      return null
    }
    return {
      batchId: batch.id,
      status: batch.status,
      channel: batch.channel,
      syncType: batch.syncType,
      totalRows: batch.totalRows,
      acceptedRows: batch.acceptedRows,
      rejectedRows: batch.rejectedRows,
      receivedAt: batch.receivedAt,
      completedAt: batch.completedAt,
    }
  }

  /** Своя аптека ИЛИ (ключ сети И батч принадлежит той же сети) — см. DTJ-158/163. */
  private async isOwnedByPrincipal(
    batchPharmacyId: string,
    principalPharmacyId: string,
    principalChainId: string | null,
  ): Promise<boolean> {
    if (batchPharmacyId === principalPharmacyId) {
      return true
    }
    if (principalChainId === null) {
      return false
    }
    const batchPharmacyChainId = await this.syncBatchRepository.findPharmacyChainId(batchPharmacyId)
    return batchPharmacyChainId === principalChainId
  }
}
