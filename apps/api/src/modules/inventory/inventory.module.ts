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
import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { RedisModule } from '@/infrastructure/redis/redis.module.js'
import { PHARMACY_INVENTORY_REPOSITORY } from './application/ports/pharmacy-inventory.repository.port.js'
import { INVENTORY_SYNC_BATCH_REPOSITORY } from './application/ports/inventory-sync-batch.repository.port.js'
import { PHARMACY_SKU_MAPPING_REPOSITORY } from './application/ports/pharmacy-sku-mapping.repository.port.js'
import { INVENTORY_OUTBOX } from './application/ports/inventory-outbox.port.js'
import { FULL_SYNC_COMPLETION } from './application/ports/full-sync-completion.port.js'
import { INVENTORY_SYNC_QUEUE } from './application/ports/inventory-sync-queue.port.js'
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
import { CompositeInventoryMatcherService } from './application/services/composite-inventory-matcher.service.js'
import { DetectStuckFullSyncSessionsUseCase } from './application/use-cases/detect-stuck-full-sync-sessions.use-case.js'
import { FullSyncSessionWatchdogCron } from './infrastructure/jobs/full-sync-session-watchdog.cron.js'
import { BullmqInventorySyncQueueAdapter } from './infrastructure/adapters/bullmq-inventory-sync-queue.adapter.js'
import { DrizzleFullSyncCompletionAdapter } from './infrastructure/adapters/drizzle-full-sync-completion.adapter.js'
import { DrizzleInventorySyncErrorsRepository } from './infrastructure/adapters/drizzle-inventory-sync-errors.repository.js'

@Module({
  imports: [AuthModule, RedisModule],
  providers: [
    { provide: PHARMACY_INVENTORY_REPOSITORY, useClass: InMemoryPharmacyInventoryRepository },
    { provide: INVENTORY_SYNC_BATCH_REPOSITORY, useClass: InMemoryInventorySyncBatchRepository },
    { provide: PHARMACY_SKU_MAPPING_REPOSITORY, useClass: InMemoryPharmacySkuMappingRepository },
    { provide: INVENTORY_OUTBOX, useClass: InMemoryInventoryOutbox },
    { provide: FULL_SYNC_COMPLETION, useClass: InMemoryFullSyncCompletion },
    { provide: INVENTORY_SYNC_QUEUE, useClass: BullmqInventorySyncQueueAdapter },
    { provide: PHARMACY_API_KEY_VERIFICATION, useClass: InMemoryPharmacyApiKeyVerificationAdapter },
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
    DetectStuckFullSyncSessionsUseCase,
    FullSyncSessionWatchdogCron,
    BullmqInventorySyncQueueAdapter,
    // DrizzleFullSyncCompletionAdapter зарегистрирован для инжекции
    // через `DrizzleDb`-провайдер, но как `FULL_SYNC_COMPLETION` активен
    // InMemory-вариант (TODO: переключить при наличии БД).
    DrizzleFullSyncCompletionAdapter,
    // DTJ-145: реальная Postgres-запись `inventory_sync_errors`. НЕ активна
    // как `INVENTORY_SYNC_BATCH_REPOSITORY` — см. JSDoc модуля выше и
    // JSDoc класса (блокер: FK на `inventory_sync_batch`, DTJ-154).
    DrizzleInventorySyncErrorsRepository,
  ],
  controllers: [InventoryBatchUpdateController],
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
