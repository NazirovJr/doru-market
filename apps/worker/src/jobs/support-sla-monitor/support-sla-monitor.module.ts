/**
 * `SupportSlaMonitorModule` (EP-14, DTJ-280) — зеркало `PickupSlaTimeoutModule` (DTJ-254) по
 * структуре: собственный `pg.Pool` (собственный DI-токен), собственные `useFactory`-биндинги
 * `API_INTERNAL_URL`/`INTERNAL_API_KEY` поверх ТЕХ ЖЕ ENV-ключей (не общий provider-модуль — тот
 * же приём, что все остальные internal-мосты apps/worker), `onModuleDestroy` закрывает и очередь,
 * и пул.
 */
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { Pool } from 'pg'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import type { WorkerEnv } from '../../config/env.schema.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import { PgSupportSlaScannerAdapter } from './pg-support-sla-scanner.adapter.js'
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN } from './escalate-support-ticket.client.js'
import {
  SUPPORT_SLA_MONITOR_CRON,
  SUPPORT_SLA_MONITOR_DB_POOL,
  SUPPORT_SLA_MONITOR_QUEUE,
  SUPPORT_SLA_MONITOR_QUEUE_TOKEN,
  SUPPORT_SLA_RE_ESCALATION_MINUTES,
} from './support-sla-monitor.constants.js'
import { SUPPORT_SLA_TICKET_SCANNER, SupportSlaMonitorJob } from './support-sla-monitor.job.js'
import { SupportSlaMonitorScheduleConfig, SupportSlaMonitorScheduler } from './support-sla-monitor.scheduler.js'

@Module({
  providers: [
    {
      provide: SUPPORT_SLA_MONITOR_DB_POOL,
      useFactory: (configService: ConfigService<WorkerEnv, true>): Pool =>
        new Pool({ connectionString: configService.get('DATABASE_URL', { infer: true }) }),
      inject: [ConfigService],
    },
    {
      provide: SUPPORT_SLA_MONITOR_CRON,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('SUPPORT_SLA_MONITOR_CRON', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: SUPPORT_SLA_RE_ESCALATION_MINUTES,
      useFactory: (configService: ConfigService<WorkerEnv, true>): number =>
        configService.get('SUPPORT_SLA_RE_ESCALATION_MINUTES', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: API_INTERNAL_URL_TOKEN,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string =>
        configService.get('API_INTERNAL_URL', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: INTERNAL_API_KEY_TOKEN,
      useFactory: (configService: ConfigService<WorkerEnv, true>): string | undefined =>
        configService.get('INTERNAL_API_KEY', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: SUPPORT_SLA_MONITOR_QUEUE_TOKEN,
      useFactory: (connection: Redis): Queue => new Queue(SUPPORT_SLA_MONITOR_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    { provide: SUPPORT_SLA_TICKET_SCANNER, useClass: PgSupportSlaScannerAdapter },
    SupportSlaMonitorScheduleConfig,
    SupportSlaMonitorJob,
    SupportSlaMonitorScheduler,
  ],
})
export class SupportSlaMonitorModule implements OnModuleDestroy {
  constructor(
    @Inject(SUPPORT_SLA_MONITOR_QUEUE_TOKEN) private readonly monitorQueue: Queue,
    @Inject(SUPPORT_SLA_MONITOR_DB_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.monitorQueue.close(), this.pool.end()])
  }
}
