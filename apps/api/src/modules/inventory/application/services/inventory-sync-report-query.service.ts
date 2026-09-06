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
import type { UserRole } from '@dorutj/contracts'
import type { Locale } from '@dorutj/i18n'
import type { BatchStatus, SyncType, InventorySyncBatchSnapshot } from '../../domain/inventory-sync-batch.entity.js'
import type { InventorySyncChannel } from '../../domain/inventory-sync.types.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
  type InventorySyncRowErrorCode,
} from '../ports/inventory-sync-batch.repository.port.js'
import {
  CATALOG_MATCH_QUEUE_READ,
  type CatalogMatchQueueReadPort,
} from '../ports/catalog-match-queue-read.port.js'
import { translateInventoryRowErrorCode } from './inventory-row-error-i18n.util.js'

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

/** Актор человеческой роли (DTJ-163/164) — то же подмножество полей, что `JwtClaims`, без прямой зависимости от `auth`. */
export interface InventoryReportActor {
  readonly role: UserRole
  readonly pharmacyId: string | null
  readonly chainId: string | null
}

/** DTJ-163: один элемент курсорного списка (SRS-INV-043). */
export interface InventorySyncBatchListItemResult {
  readonly batchId: string
  readonly channel: InventorySyncChannel
  readonly syncType: SyncType
  readonly status: BatchStatus
  readonly totalRows: number
  readonly acceptedRows: number
  readonly rejectedRows: number
  readonly receivedAt: Date
  readonly completedAt: Date | null
  readonly sourceUploadId: string | null
}

export interface ListBatchesForReportResult {
  readonly items: readonly InventorySyncBatchListItemResult[]
  readonly hasMore: boolean
  readonly nextCursor: { readonly v: string; readonly id: string } | null
}

/** DTJ-163/164: одна построчная ошибка, уже с локализованным `message` (SRS-INV-044). */
export interface InventorySyncRowErrorForActorResult {
  readonly rowIndex: number
  readonly errorCode: InventorySyncRowErrorCode
  readonly message: string
  readonly rawRow: Readonly<Record<string, unknown>> | null
}

/** DTJ-164: отчёт об ошибках Excel-импорта — объединяет ВСЕ батчи одного `sourceUploadId`. */
export interface ExcelImportErrorReportResult {
  readonly rows: readonly InventorySyncRowErrorForActorResult[]
}

@Injectable()
export class InventorySyncReportQueryService {
  constructor(
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    @Inject(CATALOG_MATCH_QUEUE_READ)
    private readonly catalogMatchQueueRead: CatalogMatchQueueReadPort,
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

  /**
   * DTJ-163 `GET /inventory-sync-batches` — курсорный список (SRS-INV-043). Скоуп по роли
   * — см. `resolveReportScope`: `pharmacist`/`pharmacy_admin` скоуп ПРИНУДИТЕЛЬНО сужен до
   * своей аптеки/сети, `filterPharmacyId` для этих ролей молчаливо ИГНОРИРУЕТСЯ (не
   * `403`/`404` — попытка обойти скоуп не создаёт заметный сигнал атакующему, см. риски тикета).
   */
  async listBatchesForReport(input: {
    readonly actor: InventoryReportActor
    readonly filterPharmacyId: string | null
    readonly cursor: { readonly v: string; readonly id: string } | null
    readonly limit: number
  }): Promise<ListBatchesForReportResult> {
    const scope = resolveReportScope(input.actor, input.filterPharmacyId)
    const { items, hasMore } = await this.syncBatchRepository.findManyForReport({
      pharmacyId: scope.pharmacyId,
      chainId: scope.chainId,
      cursor: input.cursor,
      limit: input.limit,
    })
    const lastItem = items[items.length - 1]
    const nextCursor =
      hasMore && lastItem !== undefined ? { v: lastItem.receivedAt.toISOString(), id: lastItem.id } : null
    return { items: items.map(toListItemResult), hasMore, nextCursor }
  }

  /**
   * DTJ-163 `GET /:batchId/errors` (SRS-INV-044) — `null`, если батч не найден ИЛИ не
   * принадлежит актору (оба случая → `404`, тот же приём, что DTJ-158 — не подтверждаем
   * существование чужого батча).
   */
  async getRowErrorsForActor(input: {
    readonly batchId: string
    readonly actor: InventoryReportActor
    readonly locale: Locale
  }): Promise<readonly InventorySyncRowErrorForActorResult[] | null> {
    const batch = await this.syncBatchRepository.findById(input.batchId)
    if (batch === null) return null
    const owned = await this.isOwnedByActor(batch.pharmacyId, input.actor)
    if (!owned) return null
    const errors = await this.syncBatchRepository.findRowErrorsByBatchId(input.batchId)
    return errors.map((error) => ({
      rowIndex: error.rowIndex,
      errorCode: error.errorCode,
      message: translateInventoryRowErrorCode(error.errorCode, input.locale),
      rawRow: error.rawRow,
    }))
  }

  /**
   * DTJ-163 `GET /pending-moderation-count` (SRS-INV-046) — только число, НЕ содержимое
   * очереди. `null` — актор не владеет этой аптекой (та же изоляция, что `/errors`, 404).
   */
  async getPendingModerationCount(input: {
    readonly pharmacyId: string
    readonly actor: InventoryReportActor
  }): Promise<number | null> {
    const owned = await this.isOwnedByActor(input.pharmacyId, input.actor)
    if (!owned) return null
    return this.catalogMatchQueueRead.countPending(input.pharmacyId)
  }

  /**
   * DTJ-164 `GET /:sourceUploadId/error-report` (SRS-INV-045) — объединяет `inventory_sync_errors`
   * ПО ВСЕМ батчам одной Excel-загрузки (`findBySourceUploadId`, включает синтетический
   * parser-errors контейнер DTJ-161/164). `null` — `sourceUploadId` не найден, не принадлежит
   * актору, ИЛИ импорт завершился без единой ошибки (АС3: «нет смысла скачивать пустой отчёт») —
   * все три случая дают `404` контроллеру, не различаются намеренно (SRS-API-046-style).
   */
  async getErrorReportForActor(input: {
    readonly sourceUploadId: string
    readonly actor: InventoryReportActor
    readonly locale: Locale
  }): Promise<ExcelImportErrorReportResult | null> {
    const batches = await this.syncBatchRepository.findBySourceUploadId(input.sourceUploadId)
    const firstBatch = batches[0]
    if (firstBatch === undefined) return null
    const owned = await this.isOwnedByActor(firstBatch.pharmacyId, input.actor)
    if (!owned) return null
    const errorsPerBatch = await Promise.all(
      batches.map((batch) => this.syncBatchRepository.findRowErrorsByBatchId(batch.id)),
    )
    const allErrors = errorsPerBatch.flat()
    if (allErrors.length === 0) return null
    return {
      rows: allErrors.map((error) => ({
        rowIndex: error.rowIndex,
        errorCode: error.errorCode,
        message: translateInventoryRowErrorCode(error.errorCode, input.locale),
        rawRow: error.rawRow,
      })),
    }
  }

  /**
   * Владение для человеческой роли (DTJ-163/164): `super_admin` — всегда; своя аптека — для
   * ЛЮБОЙ роли; `pharmacy_admin` дополнительно — своя сеть; `pharmacist` — ТОЛЬКО своя аптека
   * (не расширяется до сети, в отличие от `pharmacy_admin`).
   */
  private async isOwnedByActor(batchPharmacyId: string, actor: InventoryReportActor): Promise<boolean> {
    if (actor.role === 'super_admin') return true
    if (actor.pharmacyId === batchPharmacyId) return true
    if (actor.role === 'pharmacist' || actor.chainId === null) return false
    const batchChainId = await this.syncBatchRepository.findPharmacyChainId(batchPharmacyId)
    return batchChainId === actor.chainId
  }
}

/**
 * Скоуп списка (DTJ-163 «Что сделать» п.2): `pharmacist`/`pharmacy_admin` — молчаливо
 * принудительный скоуп, `filterPharmacyId` для них игнорируется. `pharmacy_admin` без сети
 * (`chainId===null`, самостоятельная аптека вне сети) — падает обратно на свою аптеку
 * (тот же принцип, что `isOwnedByPrincipal` DTJ-158 для системного принципала).
 */
function resolveReportScope(
  actor: InventoryReportActor,
  filterPharmacyId: string | null,
): { readonly pharmacyId: string | null; readonly chainId: string | null } {
  if (actor.role === 'pharmacist') {
    return { pharmacyId: actor.pharmacyId, chainId: null }
  }
  if (actor.role === 'pharmacy_admin') {
    return actor.chainId !== null
      ? { pharmacyId: null, chainId: actor.chainId }
      : { pharmacyId: actor.pharmacyId, chainId: null }
  }
  // super_admin: свободный фильтр (может быть `null` — без ограничения).
  return { pharmacyId: filterPharmacyId, chainId: null }
}

function toListItemResult(snapshot: InventorySyncBatchSnapshot): InventorySyncBatchListItemResult {
  return {
    batchId: snapshot.id,
    channel: snapshot.channel,
    syncType: snapshot.syncType,
    status: snapshot.status,
    totalRows: snapshot.totalRows,
    acceptedRows: snapshot.acceptedRows,
    rejectedRows: snapshot.rejectedRows,
    receivedAt: snapshot.receivedAt,
    completedAt: snapshot.completedAt,
    sourceUploadId: snapshot.sourceUploadId ?? null,
  }
}
