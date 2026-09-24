import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. обоснование в common/health/health.service.ts) —
// относительный путь до правки nest-cli.json.
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts); относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  OUTBOX_RELAY_JOB_NAME,
  OUTBOX_RELAY_QUEUE,
  OUTBOX_RELAY_SCHEDULER_ID,
  OUTBOX_POLL_INTERVAL_MS,
} from './outbox-relay.constants.js'
import { OutboxRelayProcessor } from './outbox-relay.processor.js'

/**
 * Планирование тика outbox-relay через BullMQ `repeat` (DTJ-002, шаг 5): регистрирует
 * повторяющуюся джобу (`upsertJobScheduler`, идемпотентно) и `Worker`, который на каждый тик
 * вызывает `OutboxRelayProcessor.relayOnce()`. AC3 тикета: джоба выполняется на расписании без
 * падения процесса, даже когда `claimPending()` всегда возвращает пустой батч.
 *
 * `onModuleInit` НЕ ждёт `upsertJobScheduler` (не `async`, не блокирует граф DI Nest): иначе
 * недоступный при старте Redis блокирует ВЕСЬ `NestFactory.createApplicationContext`, а вместе
 * с ним — старт `GET /health` в main.ts, что прямо противоречит AC1/AC2 тикета (health обязан
 * отвечать 503, а не зависать, пока воркер ждёт первого успешного соединения).
 */
@Injectable()
export class OutboxRelayScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayScheduler.name)
  private worker: Worker | undefined

  constructor(
    @Inject(OUTBOX_RELAY_QUEUE) private readonly relayQueue: Queue,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly processor: OutboxRelayProcessor,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(this.relayQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`outbox-relay: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.relayQueue.upsertJobScheduler(
      OUTBOX_RELAY_SCHEDULER_ID,
      { every: OUTBOX_POLL_INTERVAL_MS },
      { name: OUTBOX_RELAY_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    const processed = await this.processor.relayOnce()
    this.logger.log(`outbox-relay: тик выполнен, обработано ${String(processed)} событие(й)`)
  }
}
