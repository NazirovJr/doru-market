/**
 * `InventoryExcelImportController` (EP-05, DTJ-161, SRS-INV-014).
 *
 * `POST /api/v1/inventory-excel-import` (`multipart/form-data`: файл `.xlsx`/`.csv` + поле
 * `mode`) — аптека без автоматизации загружает файл шаблона (DTJ-159) целиком, файл до
 * `EXCEL_IMPORT_MAX_ROWS` строк не помещается в лимит одного батча (1000, REQ-SYNC-4),
 * поэтому контроллер:
 *   1. Синхронно парсит файл (`ExcelInventoryParserPort`, DTJ-160) — быстро, чтение файла,
 *      не запись в БД.
 *   2. Если ВСЕ строки провалили парсинг (`rows.length===0`) — `400 VALIDATION_ERROR`,
 *      ни один батч не создаётся (пустой валидный импорт бессмыслен).
 *   3. Иначе — делит успешно распарсенные строки на чанки по 1000
 *      (`buildExcelImportBatchPlans`, чистая функция) и персистирует КАЖДЫЙ чанк ТЕМ ЖЕ
 *      путём, что REST-канал (`PersistInventorySyncBatchService`, DTJ-157/161 DoD) — свой
 *      `batch_id`, свои raw items, своё outbox-событие `queued`; ОБЪЕДИНЯЮТСЯ одним
 *      `sourceUploadId` (генерируется СЕРВЕРОМ, `uuidv4()`).
 *   4. Режим `full_replace` — ВСЕ N батчей получают ОДИН `fullSyncSessionId` (=
 *      `sourceUploadId`, см. JSDoc маппера); режим `append_update` — N независимых
 *      delta-батчей. Приоритет очереди (`excel_import`+`delta`=5, `full`=10, DTJ-153) —
 *      решается воркером по `channel`/`syncType` батча, не этим контроллером.
 *   5. `202` с `{ sourceUploadId, totalBatches, totalRows, rejectedByParser }` — фронт
 *      использует `sourceUploadId` для агрегированного опроса прогресса (DTJ-163/168).
 *
 * **Батчи ОБРАБАТЫВАЮТСЯ АСИНХРОННО воркером** (в отличие от REST-канала, который R1
 * дополнительно вызывает `execute()` синхронно в контроллере) — этот контроллер НЕ
 * вызывает use case напрямую, только публикует `queued`-события. **Известный
 * межтикетный пробел (зафиксировать для координатора, не решать тихо):** на момент
 * этого тикета НИ ОДИН BullMQ-воркер/процессор НЕ подписан на
 * `inventory.sync_batch.queued` (`bullmq-inventory-sync-queue.adapter.ts` — только
 * сторона постановки job'а, `apps/worker` потребителя не содержит) — тот же пробел,
 * что у REST-канала (DTJ-157 JSDoc: «R2 — через worker»), но там R1 маскируется
 * синхронным вызовом `execute()` в контроллере. Excel-батчи, поставленные ЭТИМ
 * контроллером, останутся в статусе `queued` до появления воркера — вне периметра
 * files_owned этого тикета, требует отдельного тикета (см. риски).
 *
 * **Атомарность (риски тикета «одна транзакция на N батчей»): НЕ реализована.**
 * `InventorySyncBatchRepository.createIfNotExists`/`appendRawItems` НЕ принимают
 * опциональный `tx` (в отличие от FSM-методов `findById`/`save`/`appendErrors` —
 * см. JSDoc порта) — оборачивание N вызовов в `UnitOfWorkPort.run(...)` потребовало бы
 * расширения ПОРТА (обе реализации, Drizzle И InMemory), что выходит за пределы этого
 * тикета. Каждый чанк персистируется независимо и последовательно; частичный сбой
 * посередине цикла оставит ПЕРВЫЕ K чанков персистированными, остальные — нет (риск
 * зафиксирован для координатора, не молчаливое упрощение).
 *
 * `pharmacyId` — из `claims.pharmacyId` (акт орган, не поле запроса — контракт тикета
 * не содержит `pharmacyId`, тот же приём, что `ManualEntryRequestSchema` DTJ-162).
 * `super_admin` без привязанной аптеки (`claims.pharmacyId===null`) получает
 * `400 VALIDATION_ERROR` — известное ограничение схемы контракта, не обходится молча.
 *
 * **ДОПОЛНЕНО DTJ-164** (`persistParserErrorsContainerIfNeeded`, «Что сделать» п.1 того
 * тикета): если парсер отклонил хотя бы одну строку (`rejectedRows.length > 0`) — СВЕРХ N
 * обычных батчей создаётся ОДИН синтетический батч-контейнер (`channel='excel',
 * status='failed_validation', totalRows=0`, ТЕМ ЖЕ `sourceUploadId`), хранящий
 * ПАРСЕР-ошибки в `inventory_sync_errors`/`inventory_sync_raw_items` — так отчёт DTJ-164
 * (`GET .../error-report`) читает ОДИН источник (`findBySourceUploadId` + построчные ошибки
 * ПО ВСЕМ батчам загрузки), объединяющий ошибки парсинга и ошибки use case. НЕ через
 * `PersistInventorySyncBatchService` (не публикует `queued`-событие — синтетический
 * контейнер уже терминален при создании, публикация была бы семантической ложью и обвалила
 * бы гипотетического будущего воркера на `IllegalBatchStatusTransitionError`).
 */
import { Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import {
  ErrorCode,
  fail,
  inventoryExcelImportModeSchema,
  ok,
  type InventoryExcelImportAcceptedResponse,
  type InventoryExcelImportMode,
} from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  EXCEL_INVENTORY_PARSER,
  type ExcelInventoryParserPort,
  type RejectedExcelRow,
} from '@/modules/inventory/application/ports/excel-inventory-parser.port.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import { PersistInventorySyncBatchService } from '@/modules/inventory/application/services/persist-inventory-sync-batch.service.js'
import { buildExcelImportBatchPlans } from '../mappers/excel-inventory-request-to-command.mapper.js'

const DEFAULT_MIMETYPE = 'application/octet-stream'

interface MultipartUpload {
  readonly fileBuffer: Buffer | null
  readonly mimetype: string | null
  readonly mode: string | null
}

@Controller({ path: 'inventory-excel-import', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('pharmacy_admin', 'super_admin')
export class InventoryExcelImportController {
  // 4 DI-инъекции (DTJ-164 добавил прямой доступ к InventorySyncBatchRepository для
  // синтетического parser-errors контейнера, см. JSDoc файла) — тот же приём, что исходный
  // InventoryBatchUpdateController до рефакторинга DTJ-161.
  // eslint-disable-next-line max-params -- см. комментарий выше
  constructor(
    @Inject(EXCEL_INVENTORY_PARSER) private readonly parser: ExcelInventoryParserPort,
    @Inject(PersistInventorySyncBatchService)
    private readonly persistBatch: PersistInventorySyncBatchService,
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async import(
    @Req() request: FastifyRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const pharmacyId = requirePharmacyId(claims)
    const upload = await readMultipartUpload(request)
    const mode = parseMode(upload.mode)
    if (upload.fileBuffer === null) {
      throw validationError('file', 'a file part is required')
    }

    const parseResult = await this.parser.parse(upload.fileBuffer, upload.mimetype ?? DEFAULT_MIMETYPE)
    if (parseResult.rows.length === 0) {
      throw validationError('file', 'file has no valid rows to import')
    }

    const sourceUploadId = randomUUID()
    const plans = buildExcelImportBatchPlans({
      parsedRows: parseResult.rows,
      pharmacyId,
      mode,
      sourceUploadId,
      generateBatchId: randomUUID,
    })
    await this.persistPlans(plans)
    await this.persistParserErrorsContainerIfNeeded({
      pharmacyId,
      sourceUploadId,
      rejectedRows: parseResult.rejectedRows,
    })

    const response: InventoryExcelImportAcceptedResponse = {
      sourceUploadId,
      totalBatches: plans.length,
      totalRows: parseResult.rows.length,
      rejectedByParser: parseResult.rejectedRows.length,
    }
    return ok(response)
  }

  /** Последовательно, БЕЗ общей транзакции — см. JSDoc файла «Атомарность». */
  private async persistPlans(plans: ReturnType<typeof buildExcelImportBatchPlans>): Promise<void> {
    const now = this.clock.now()
    for (const plan of plans) {
      // Намеренно последовательно (не Promise.all) — см. JSDoc файла «Атомарность»: порт
      // репозитория не поддерживает `tx` для createIfNotExists/appendRawItems, последовательный
      // цикл — самый предсказуемый порядок персистенции при частичном сбое посередине.
      // eslint-disable-next-line no-await-in-loop -- см. комментарий выше
      await this.persistBatch.persistAndQueue({
        batchId: plan.batchId,
        pharmacyId: plan.pharmacyId,
        channel: plan.channel,
        syncType: plan.syncType,
        fullSyncSessionId: plan.fullSyncSessionId,
        isLastPage: plan.isLastPage,
        note: null,
        now,
        sourceUploadId: plan.sourceUploadId,
        rows: plan.rows,
      })
    }
  }

  /**
   * DTJ-164 «Что сделать» п.1 — синтетический батч-контейнер ТОЛЬКО если парсер отклонил
   * хотя бы одну строку. `syncType='delta'`/`fullSyncSessionId=null` независимо от режима
   * загрузки (`mode`) — контейнер не участвует в FSM полной синхронизации, это чистый
   * контейнер ошибок. НЕ используем `PersistInventorySyncBatchService` — см. JSDoc файла.
   */
  private async persistParserErrorsContainerIfNeeded(input: {
    readonly pharmacyId: string
    readonly sourceUploadId: string
    readonly rejectedRows: readonly RejectedExcelRow[]
  }): Promise<void> {
    if (input.rejectedRows.length === 0) return
    const now = this.clock.now()
    const { batch } = await this.syncBatchRepository.createIfNotExists({
      id: randomUUID(),
      pharmacyId: input.pharmacyId,
      channel: 'excel',
      syncType: 'delta',
      fullSyncSessionId: null,
      isLastPage: true,
      totalRows: 0,
      note: 'parser-errors container (DTJ-160/164)',
      now,
      sourceUploadId: input.sourceUploadId,
    })
    batch.markProcessing()
    batch.markFailedValidation(
      input.rejectedRows.map((row) => ({ rowIndex: row.rowIndex, reason: row.reason })),
      now,
    )
    await this.syncBatchRepository.save(batch)
    await this.syncBatchRepository.appendRawItems(
      batch.id,
      input.rejectedRows.map((row) => ({ rowIndex: row.rowIndex, payload: row.rawRow })),
    )
    await this.syncBatchRepository.appendErrors(
      input.rejectedRows.map((row) => ({
        batchId: batch.id,
        rowIndex: row.rowIndex,
        errorCode: row.errorCode,
        reason: row.reason,
      })),
    )
  }
}

function requirePharmacyId(claims: JwtClaims): string {
  if (claims.pharmacyId === null) {
    throw validationError('pharmacyId', 'acting user has no associated pharmacy to import into')
  }
  return claims.pharmacyId
}

function parseMode(raw: string | null): InventoryExcelImportMode {
  const result = inventoryExcelImportModeSchema.safeParse(raw)
  if (!result.success) {
    throw validationError('mode', 'mode is required and must be "append_update" or "full_replace"')
  }
  return result.data
}

function validationError(field: string, message: string): HttpException {
  return new HttpException(fail(ErrorCode.VALIDATION_ERROR, message, { field }), HttpStatus.BAD_REQUEST)
}

/**
 * Дренирует ВЕСЬ multipart-поток через `request.parts()` (не `request.file()`) —
 * `@fastify/multipart` кладёт в `MultipartFile.fields` ТОЛЬКО поля, пришедшие ДО файловой
 * части потока (известная особенность библиотеки); `parts()` устойчив к порядку полей
 * формы (клиент может прислать `mode` до ИЛИ после файла).
 */
async function readMultipartUpload(request: FastifyRequest): Promise<MultipartUpload> {
  let fileBuffer: Buffer | null = null
  let mimetype: string | null = null
  let mode: string | null = null
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      fileBuffer = await part.toBuffer()
      mimetype = part.mimetype
    } else if (part.fieldname === 'mode') {
      mode = typeof part.value === 'string' ? part.value : String(part.value)
    }
  }
  return { fileBuffer, mimetype, mode }
}
