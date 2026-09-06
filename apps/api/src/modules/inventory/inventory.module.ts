/**
 * NestJS-модуль `inventory` (EP-05, DTJ-140). Barrel-файл (D-27) — правится
 * ТОЛЬКО добавлением строк. Текущее содержимое:
 *   - `IngestInventoryBatchUseCase` (DTJ-148) — устаревший плоский путь R1-бутстрапа.
 *   - `IngestInventoryBatchWithMatchingUseCase` (DTJ-148) — полный FSM + matcher.
 *     Контроллер пока вызывает СТАРЫЙ use case; миграция — DTJ-157/161.
 *   - `CompositeInventoryMatcherService` (DTJ-146/147) — composite-матчинг (шаги 1-4).
 *   - `DetectStuckFullSyncSessionsUseCase` + cron (DTJ-152) — watchdog зависших сессий.
 *   - `BullmqInventorySyncQueueAdapter` (DTJ-153) — постановка job'ов в очередь.
 *   - `InventoryBatchUpdateController` (DTJ-157) — `POST /api/v1/inventory/batch-update`.
 *   - InMemory-адаптеры репозиториев (Drizzle-реализации — DTJ-154, ждут БД).
 *
 * `DrizzleFullSyncCompletionAdapter` (DTJ-151) зарегистрирован, но НЕ
 * активирован — провайдер остаётся `InMemoryFullSyncCompletion` до
 * разблокировки БД-инфраструктуры.
 *
 * `DrizzleInventorySyncErrorsRepository` (DTJ-145) — реальная Postgres-запись
 * построчных ошибок батча в `inventory_sync_errors`. Зарегистрирована как
 * самостоятельный DI-провайдер (не биндинг `INVENTORY_SYNC_BATCH_REPOSITORY`
 * целиком): её FK `batch_id → inventory_sync_batch(id)` требует, чтобы батч
 * уже существовал строкой в реальном Postgres, а это (`findById`/`save`/
 * `createIfNotExists`) — Drizzle-персистентность DTJ-154, которой ещё нет
 * (сегодня батч существует только в `InMemoryInventorySyncBatchRepository`).
 * Переключать `INVENTORY_SYNC_BATCH_REPOSITORY` до DTJ-154 нельзя — это
 * уронит FK-constraint'ом каждый реальный `POST /inventory/batch-update`.
 * См. JSDoc `drizzle-inventory-sync-errors.repository.ts`.
 */
/**
 * ОБНОВЛЕНО — волна 5, блок C (`reports/CTO-DECISION-WAVE5.md` §3): DTJ-154
 * закрыт, блокер FK из абзаца выше СНЯТ. Все шесть портов ниже переведены
 * с `InMemory*` на Drizzle-реализации (персистентность переживает рестарт
 * процесса — приёмочный критерий волны 5). Абзацы выше про
 * `InMemoryFullSyncCompletion`/недоступность `INVENTORY_SYNC_BATCH_REPOSITORY`
 * — ИСТОРИЯ (как решение появилось), не текущее состояние; текущее —
 * `providers` ниже. `InMemory*`-классы НЕ удалены (используются в
 * unit-тестах контроллера/гварда — конструируются напрямую `new`, не через
 * DI) и остаются доступны как отдельные провайдеры.
 */
import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { RedisModule } from '@/infrastructure/redis/redis.module.js'
import { PHARMACY_INVENTORY_REPOSITORY } from './application/ports/pharmacy-inventory.repository.port.js'
import { INVENTORY_SYNC_BATCH_REPOSITORY } from './application/ports/inventory-sync-batch.repository.port.js'
import { PHARMACY_SKU_MAPPING_REPOSITORY } from './application/ports/pharmacy-sku-mapping.repository.port.js'
import { INVENTORY_OUTBOX } from './application/ports/inventory-outbox.port.js'
import { FULL_SYNC_COMPLETION } from './application/ports/full-sync-completion.port.js'
import { INVENTORY_SYNC_QUEUE } from './application/ports/inventory-sync-queue.port.js'
import { EXCEL_INVENTORY_PARSER } from './application/ports/excel-inventory-parser.port.js'
import { PHARMACY_API_KEY_VERIFICATION } from './application/ports/pharmacy-api-key-verification.port.js'
import { InMemoryPharmacyApiKeyVerificationAdapter } from './infrastructure/adapters/in-memory-pharmacy-api-key-verification.adapter.js'
import { PharmacyApiKeyGuard } from './presentation/guards/pharmacy-api-key.guard.js'
import { InMemoryPharmacyInventoryRepository } from './infrastructure/adapters/in-memory-pharmacy-inventory.repository.js'
import { InMemoryInventorySyncBatchRepository } from './infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InMemoryPharmacySkuMappingRepository } from './infrastructure/adapters/in-memory-pharmacy-sku-mapping.repository.js'
import { InMemoryInventoryOutbox } from './infrastructure/adapters/in-memory-inventory-outbox.js'
import { InMemoryFullSyncCompletion } from './infrastructure/adapters/in-memory-full-sync-completion.js'
import { IngestInventoryBatchUseCase } from './application/use-cases/ingest-inventory-batch.use-case.js'
import { IngestInventoryBatchWithMatchingUseCase } from './application/use-cases/ingest-inventory-batch-with-matching.use-case.js'
import { InventoryBatchUpdateController } from './presentation/controllers/inventory-batch-update.controller.js'
import { InventorySyncBatchStatusController } from './presentation/controllers/inventory-sync-batch-status.controller.js'
import { InventoryImportTemplateController } from './presentation/controllers/inventory-import-template.controller.js'
import { InventoryExcelImportController } from './presentation/controllers/inventory-excel-import.controller.js'
import { InventoryManualEntryController } from './presentation/controllers/inventory-manual-entry.controller.js'
import { CompositeInventoryMatcherService } from './application/services/composite-inventory-matcher.service.js'
import { InventorySyncReportQueryService } from './application/services/inventory-sync-report-query.service.js'
import { PersistInventorySyncBatchService } from './application/services/persist-inventory-sync-batch.service.js'
import { DetectStuckFullSyncSessionsUseCase } from './application/use-cases/detect-stuck-full-sync-sessions.use-case.js'
import { FullSyncSessionWatchdogCron } from './infrastructure/jobs/full-sync-session-watchdog.cron.js'
import { BullmqInventorySyncQueueAdapter } from './infrastructure/adapters/bullmq-inventory-sync-queue.adapter.js'
import { DrizzleFullSyncCompletionAdapter } from './infrastructure/adapters/drizzle-full-sync-completion.adapter.js'
import { DrizzleInventorySyncErrorsRepository } from './infrastructure/adapters/drizzle-inventory-sync-errors.repository.js'
import { DrizzlePharmacyInventoryRepository } from './infrastructure/adapters/drizzle-pharmacy-inventory.repository.js'
import { DrizzlePharmacySkuMappingRepository } from './infrastructure/adapters/drizzle-pharmacy-sku-mapping.repository.js'
import { DrizzleInventoryOutboxAdapter } from './infrastructure/adapters/drizzle-inventory-outbox.adapter.js'
import { DrizzleInventorySyncBatchRepository } from './infrastructure/adapters/drizzle-inventory-sync-batch.repository.js'
import { DrizzleInventorySyncReportRepository } from './infrastructure/adapters/drizzle-inventory-sync-report.repository.js'
import { DrizzlePharmacyApiKeyVerificationAdapter } from './infrastructure/adapters/drizzle-pharmacy-api-key-verification.adapter.js'
import { XlsxExcelInventoryParserAdapter } from './infrastructure/adapters/xlsx-excel-inventory-parser.adapter.js'

@Module({
  imports: [AuthModule, RedisModule],
  providers: [
    // Волна 5, блок C: все шесть портов ниже — Drizzle/Redis, не InMemory
    // (см. addendum в JSDoc модуля выше). `InMemory*`-классы остаются
    // отдельными провайдерами (следующий блок) для unit-тестов.
    { provide: PHARMACY_INVENTORY_REPOSITORY, useClass: DrizzlePharmacyInventoryRepository },
    { provide: INVENTORY_SYNC_BATCH_REPOSITORY, useClass: DrizzleInventorySyncBatchRepository },
    { provide: PHARMACY_SKU_MAPPING_REPOSITORY, useClass: DrizzlePharmacySkuMappingRepository },
    { provide: INVENTORY_OUTBOX, useClass: DrizzleInventoryOutboxAdapter },
    { provide: FULL_SYNC_COMPLETION, useClass: DrizzleFullSyncCompletionAdapter },
    { provide: INVENTORY_SYNC_QUEUE, useClass: BullmqInventorySyncQueueAdapter },
    { provide: PHARMACY_API_KEY_VERIFICATION, useClass: DrizzlePharmacyApiKeyVerificationAdapter },
    // DTJ-160: единственная реализация — `exceljs`, тот же пакет, что генератор шаблона DTJ-159.
    { provide: EXCEL_INVENTORY_PARSER, useClass: XlsxExcelInventoryParserAdapter },
    InMemoryPharmacyApiKeyVerificationAdapter,
    PharmacyApiKeyGuard,
    InMemoryPharmacyInventoryRepository,
    InMemoryInventorySyncBatchRepository,
    InMemoryPharmacySkuMappingRepository,
    InMemoryInventoryOutbox,
    InMemoryFullSyncCompletion,
    IngestInventoryBatchUseCase,
    IngestInventoryBatchWithMatchingUseCase,
    CompositeInventoryMatcherService,
    InventorySyncReportQueryService,
    // DTJ-161: общий шаг «создать батч + raw items + outbox queued» — REST (DTJ-157) и
    // Excel-import (этот тикет), см. её JSDoc.
    PersistInventorySyncBatchService,
    DetectStuckFullSyncSessionsUseCase,
    FullSyncSessionWatchdogCron,
    BullmqInventorySyncQueueAdapter,
    // Волна 5, блок C: активен как `FULL_SYNC_COMPLETION` (см. binding выше).
    DrizzleFullSyncCompletionAdapter,
    // DTJ-145: реальная Postgres-запись `inventory_sync_errors`. Волна 5,
    // блок C: FK-блокер снят (DTJ-154), теперь используется И напрямую
    // (was: только этим классом), И как зависимость
    // `DrizzleInventorySyncBatchRepository.appendErrors` (делегирование,
    // см. JSDoc `drizzle-inventory-sync-batch.repository.ts`).
    DrizzleInventorySyncErrorsRepository,
    // DTJ-163/164: read-side отчёта кабинета, делегирование из
    // `DrizzleInventorySyncBatchRepository` (см. её JSDoc) — самостоятельный
    // провайдер, тот же приём, что `DrizzleInventorySyncErrorsRepository`.
    DrizzleInventorySyncReportRepository,
  ],
  controllers: [
    InventoryBatchUpdateController,
    InventorySyncBatchStatusController,
    InventoryImportTemplateController,
    InventoryExcelImportController,
    InventoryManualEntryController,
  ],
  exports: [
    PHARMACY_INVENTORY_REPOSITORY,
    INVENTORY_SYNC_BATCH_REPOSITORY,
    PHARMACY_SKU_MAPPING_REPOSITORY,
    INVENTORY_OUTBOX,
    FULL_SYNC_COMPLETION,
    INVENTORY_SYNC_QUEUE,
    IngestInventoryBatchUseCase,
    IngestInventoryBatchWithMatchingUseCase,
    CompositeInventoryMatcherService,
    DetectStuckFullSyncSessionsUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class InventoryModule {}
