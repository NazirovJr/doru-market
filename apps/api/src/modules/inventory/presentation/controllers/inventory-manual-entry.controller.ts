/**
 * `InventoryManualEntryController` (EP-05, DTJ-162, SRS-INV-015/016).
 *
 * `POST /api/v1/inventory-manual-entry` — точечное редактирование (`rows.length===1`) И
 * массовый ручной ввод (сетка UI, `rows.length` до 1000) остатков фармацевтом/`pharmacy_admin`
 * кабинета, который УЖЕ выбрал медикамент через каталожный автокомплит — `medicineId`
 * известен, composite-матчинг избыточен (см. JSDoc маппера).
 *
 * **Архитектурное решение (намеренное, не забытая оптимизация — см. «Технический контекст»
 * тикета): вызывается СИНХРОННО.** В отличие от REST (DTJ-157, асинхронно через outbox) и
 * Excel (DTJ-161, N батчей через outbox), этот контроллер вызывает
 * `IngestInventoryBatchWithMatchingUseCase.execute(command)` НАПРЯМУЮ в теле HTTP-обработчика
 * и возвращает `200` с РЕАЛЬНЫМ финальным результатом (не промежуточный `202 queued`) — объём
 * ограничен (`rows.length<=1000`, практически ≤100 — UI пагинирует сетку), resolved-строки не
 * проходят дорогой fuzzy-матчинг, риск для времени ответа минимален. НЕ использует
 * `PersistInventorySyncBatchService` (DTJ-161) — этот канал НЕ ставит батч в очередь (нет
 * outbox `queued`-события, семантически неверно публиковать «поставлено в очередь» для батча,
 * который уже терминален к моменту ответа) и не пишет `inventory_sync_raw_items` (нет сырых
 * данных для аудита — вход уже `resolved`, см. `InventoryRowErrorDetail.rawRow` — для этого
 * канала он всегда `null` в отчёте DTJ-163/164, порт это уже допускает).
 *
 * **RBAC — расхождение документов, решено в пользу `12-api-conventions-auth-tenancy.md`**
 * (нормативный документ для permission-матрицы): только `pharmacy_admin`/`super_admin`, НЕ
 * `pharmacist` (SRS-INV-015 буквально упоминает фармацевта, но `12` §4 — `inventory:ingest`
 * только для первых двух ролей). Открытый вопрос для продуктовой команды перед мержем — см.
 * «Риски» тикета, решение меняется в ОДНОМ месте (`@Roles(...)` ниже), если потребуется.
 *
 * **НЕ обрабатывает «Товара нет в списке» (SRS-INV-016)** — тот сценарий создаёт черновик
 * `catalog_match_queue` через отдельный эндпоинт `catalog`/`moderation`, вне периметра EP-05;
 * фронт (DTJ-167) не должен переиспользовать этот эндпоинт для создания нового товара.
 */
import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  ErrorCode,
  fail,
  manualEntryRequestSchema,
  ok,
  type ManualEntryRequest,
  type ManualEntryResponse,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { IngestInventoryBatchWithMatchingUseCase } from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import { ManualEntryRequestToCommandMapper } from '../mappers/manual-entry-request-to-command.mapper.js'

const ISO_DATE_LENGTH = 10

@Controller({ path: 'inventory-manual-entry', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('pharmacy_admin', 'super_admin')
export class InventoryManualEntryController {
  constructor(
    @Inject(IngestInventoryBatchWithMatchingUseCase)
    private readonly ingestBatch: IngestInventoryBatchWithMatchingUseCase,
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async submit(
    @Body(new ZodValidationPipe(manualEntryRequestSchema)) dto: ManualEntryRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const pharmacyId = requirePharmacyId(claims)
    const now = this.clock.now()
    const todayIso = now.toISOString().slice(0, ISO_DATE_LENGTH)
    const batchId = randomUUID()
    const command = ManualEntryRequestToCommandMapper.toCommand({ dto, pharmacyId, batchId, todayIso })

    // Батч создаётся здесь (НЕ через `PersistInventorySyncBatchService`, см. JSDoc файла) —
    // `execute()` ниже требует, чтобы строка `inventory_sync_batches` уже существовала
    // (`findById` внутри `uow.run`, тот же контракт, что REST/Excel-каналы).
    await this.syncBatchRepository.createIfNotExists({
      id: batchId,
      pharmacyId,
      channel: 'manual',
      syncType: 'delta',
      fullSyncSessionId: null,
      isLastPage: true,
      totalRows: command.rows.length,
      note: null,
      now,
    })

    const result = await this.ingestBatch.execute(command)
    const rowErrors = await this.syncBatchRepository.findRowErrorsByBatchId(batchId)

    const response: ManualEntryResponse = {
      batchId: result.batchId,
      status: result.status,
      acceptedRows: result.acceptedRows,
      rejectedRows: result.rejectedRows,
      errors: rowErrors.map((error) => ({
        rowIndex: error.rowIndex,
        errorCode: error.errorCode,
        reason: error.reason,
      })),
    }
    return ok(response)
  }
}

function requirePharmacyId(claims: JwtClaims): string {
  if (claims.pharmacyId === null) {
    throw new HttpException(
      fail(ErrorCode.VALIDATION_ERROR, 'acting user has no associated pharmacy to edit inventory for', {
        field: 'pharmacyId',
      }),
      HttpStatus.BAD_REQUEST,
    )
  }
  return claims.pharmacyId
}
