/**
 * NestJS-модуль `inventory-sync-failed` (EP-05, DTJ-155).
 *
 * Подключается к `app.module` `apps/worker`. Зависит от:
 *   - `REDIS_CONNECTION` (общий Redis-клиент worker'а — DI в `InventorySyncFailedListener`);
 *   - InMemory-порты `repository` / `outbox` (заглушки; Drizzle — DTJ-154 follow-up);
 *   - `LOGGER` — pino-инстанс (TODO: заменить на корневой логгер worker'а).
 */
import { Module } from '@nestjs/common'
import { pino } from 'pino'
import { InventorySyncFailedJobHandler } from './inventory-sync-failed.handler.js'
import { InventorySyncFailedListener } from './inventory-sync-failed.listener.js'
import { buildWorkerLoggerOptions } from './worker-logger-options.js'
import {
  INVENTORY_OUTBOX_PORT,
  INVENTORY_SYNC_BATCH_REPOSITORY_PORT,
  LOGGER,
  InMemoryInventoryOutbox,
  InMemoryInventorySyncBatchRepository,
} from './in-memory-failed-ports.js'

@Module({
  providers: [
    {
      provide: INVENTORY_SYNC_BATCH_REPOSITORY_PORT,
      useClass: InMemoryInventorySyncBatchRepository,
    },
    { provide: INVENTORY_OUTBOX_PORT, useClass: InMemoryInventoryOutbox },
    {
      provide: LOGGER,
      useFactory: () => pino(buildWorkerLoggerOptions()),
    },
    InMemoryInventorySyncBatchRepository,
    InMemoryInventoryOutbox,
    InventorySyncFailedJobHandler,
    InventorySyncFailedListener,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class InventorySyncFailedModule {}

