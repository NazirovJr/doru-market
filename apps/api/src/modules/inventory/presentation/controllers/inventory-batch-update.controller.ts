/**
 * `InventoryBatchUpdateController` (EP-05, DTJ-157, SRS-INV-001..009).
 *
 * `POST /api/v1/inventory/batch-update` — единый REST-эндпоинт для канала
 * 1С/ERP. Маршрут защищён `PharmacyApiKeyGuard` (DTJ-156), который
 * кладёт `request.principal = { type: 'pharmacy_system', pharmacyId, chainId }`.
 *
 * Поток (SRS-INV-007/009/055):
 *   1. Zod-парсинг тела (`inventoryBatchUpdateRequestSchema`).
 *   2. `createIfNotExists(batchId, ...)` — идемпотентность по `batch_id`
 *      (UUIDv7 клиента).
 *   3. Баtчевый `appendRawItems`.
 *   4. Публикация `InventoryBatchQueuedEvent` через `InventoryOutboxPort`
 *      (DTJ-153/157); `OutboxRelayWorker` транслирует это в BullMQ-job.
 *   5. Если `created=false` (повтор) — сразу возвращаем сохранённый статус.
 *   6. Если `created=true` — синхронно вызываем
 *      `IngestInventoryBatchWithMatchingUseCase.execute(command)` (R1);
 *      в R2 это переедет в worker.
 *   7. `202 Accepted` с `{ batchId, status, acceptedForProcessing: true }`.
 *
 * **TODO(EP-19, DTJ-157 follow-up):**
 *   - явная `PHARMACY_NOT_IN_CHAIN_SCOPE` проверка (DTJ-156 §5):
 *     если `principal.chainId !== null`, проверить
 *     `pharmacies WHERE id=principal.pharmacyId AND chain_id=principal.chainId`,
 *     иначе `403`. Сейчас — доверяем `principal.pharmacyId` напрямую
 *     (InMemory-адаптер его контролирует);
 *   - `@RateLimit({ max: 20, windowSec: 60, keyBy: 'pharmacyId' })`
 *     (тикет DTJ-157 §2, требует EP-01 декоратор);
 *   - `bodyLimit: 5 * 1024 * 1024` на уровне Fastify route
 *     (SRS-INV-003, требует EP-01 конфигурации);
 *   - UoW-обёртка вокруг `createIfNotExists` + `appendRawItems` + `append`
 *     (сейчас — 3 отдельных promise; для R1-бутстрапа InMemory это
 *     безопасно, для Drizzle-реализации — критично).
 */
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  type InventoryBatchUpdateRequest,
  inventoryBatchUpdateRequestSchema,
  ErrorCode,
  fail,
  ok,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  IngestInventoryBatchWithMatchingUseCase,
  type IngestInventoryBatchCommand,
  type IngestRowInput,
} from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import { INVENTORY_OUTBOX, type InventoryOutboxPort } from '@/modules/inventory/application/ports/inventory-outbox.port.js'
import {
  PharmacyApiKeyGuard,
  type FastifyRequestWithPrincipal,
  type PharmacySystemPrincipal,
} from '../guards/pharmacy-api-key.guard.js'
import { RestInventoryRequestToCommandMapper } from '../mappers/rest-inventory-request-to-command.mapper.js'

const REST_BATCH_MAX_ITEMS = 1000

@Controller({ path: 'inventory', version: '1' })
@UseGuards(PharmacyApiKeyGuard)
export class InventoryBatchUpdateController {
  // eslint-disable-next-line max-params -- 4 DI-инъекции, NestJS constructor injection резолвит по позиции; единый options-объект не идиоматичен для Nest DI
  constructor(
    // Явный @Inject(класс): esbuild (vitest) не эмитит `design:paramtypes` — без него Nest
    // падает на компиляции модуля (DTJ-001).
    @Inject(IngestInventoryBatchWithMatchingUseCase)
    private readonly ingestBatch: IngestInventoryBatchWithMatchingUseCase,
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    @Inject(INVENTORY_OUTBOX) private readonly outbox: InventoryOutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post('batch-update')
  async batchUpdate(
    @Body(new ZodValidationPipe(inventoryBatchUpdateRequestSchema))
    dto: InventoryBatchUpdateRequest,
    req: FastifyRequestWithPrincipal,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req)
    this.assertWithinItemLimit(dto)
    // (chain-scope check TODO — см. JSDoc выше)
    const now = this.clock.now()
    const command = RestInventoryRequestToCommandMapper.toCommand(
      dto,
      principal.pharmacyId,
      now,
    )
    // 1) Идемпотентное создание батча.
    const { batch, created } = await this.syncBatchRepository.createIfNotExists({
      id: command.batchId,
      pharmacyId: command.pharmacyId,
      channel: 'rest',
      syncType: command.syncType,
      fullSyncSessionId: command.fullSyncSessionId,
      isLastPage: command.isLastPage,
      totalRows: command.rows.length,
      note: null,
      now,
    })
    if (!created) {
      return ok({
        batchId: batch.id,
        status: batch.status,
        acceptedForProcessing: false,
      })
    }
    await this.persistAndQueueBatch(command)
    // 4) Синхронный вызов use case'а (R1; R2 — через worker).
    const result = await this.ingestBatch.execute(command)
    return ok({
      batchId: result.batchId,
      status: result.status,
      acceptedForProcessing: true,
    })
  }

  private requirePrincipal(req: FastifyRequestWithPrincipal): PharmacySystemPrincipal {
    const principal: PharmacySystemPrincipal | undefined = req.principal
    if (principal === undefined) {
      throw new HttpException(
        fail(ErrorCode.UNAUTHENTICATED, 'pharmacy principal required'),
        HttpStatus.UNAUTHORIZED,
      )
    }
    return principal
  }

  private assertWithinItemLimit(dto: InventoryBatchUpdateRequest): void {
    if (dto.items.length > REST_BATCH_MAX_ITEMS) {
      throw new HttpException(
        fail(
          ErrorCode.VALIDATION_ERROR,
          `items.length must be <= ${String(REST_BATCH_MAX_ITEMS)}`,
        ),
        HttpStatus.UNPROCESSABLE_ENTITY,
      )
    }
  }

  /** Шаги (2)-(3): батчевый `appendRawItems` + outbox-событие `queued`. */
  private async persistAndQueueBatch(command: IngestInventoryBatchCommand): Promise<void> {
    await this.syncBatchRepository.appendRawItems(
      command.batchId,
      command.rows.map((row) => ({ rowIndex: row.rowIndex, payload: rowToPayload(row) })),
    )
    this.outbox.appendBatchQueued({
      eventType: 'inventory.sync_batch.queued',
      batchId: command.batchId,
      pharmacyId: command.pharmacyId,
      channel: 'rest',
      syncType: command.syncType,
    })
  }
}

function rowToPayload(row: IngestRowInput): Readonly<Record<string, unknown>> {
  return {
    internal_sku: row.internalSku,
    raw_barcode: row.rawBarcode,
    raw_trade_name: row.rawTradeName,
    raw_dosage_form: row.rawDosageForm,
    raw_dosage_strength: row.rawDosageStrength,
    raw_manufacturer_name: row.rawManufacturerName,
    price_diram: row.priceDiram.toString(),
    quantity: row.quantity,
    expires_at: row.expiresAtIso,
    batch_number: row.batchNumber,
  }
}
