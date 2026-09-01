/**
 * NestJS-модуль `license-expiry-check` (DTJ-073). Зеркало `outbox-relay.module.ts`.
 *
 * `SuspendPharmacyUseCase` и `LicenseNoticeLogPort` инжектируются как
 * провайдеры из общего worker-графа — TODO(EP-01/EP-03 wiring) подключить
 * реальные адаптеры (пока заглушка).
 */
import { Inject, Module, type OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. outbox-relay.scheduler.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. outbox-relay.scheduler.ts, common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import { LICENSE_EXPIRY_CHECK_QUEUE } from './license-expiry-check.constants.js'
import {
  LICENSE_NOTICE_LOG,
  PHARMACY_LICENSE_SCANNER,
  SUSPEND_PHARMACY_USE_CASE,
  LicenseExpiryCheckProcessor,
  type LicenseNoticeLogPort,
  type PharmacyLicenseScannerPort,
  type SuspendPharmacyPort,
} from './license-expiry-check.processor.js'
import { LicenseExpiryCheckScheduler } from './license-expiry-check.scheduler.js'

@Module({
  providers: [
    {
      provide: LICENSE_EXPIRY_CHECK_QUEUE,
      useFactory: (connection: Redis): Queue => new Queue(LICENSE_EXPIRY_CHECK_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    {
      provide: PHARMACY_LICENSE_SCANNER,
      useValue: { scanActive: () => Promise.resolve([]) } satisfies PharmacyLicenseScannerPort,
    },
    {
      provide: SUSPEND_PHARMACY_USE_CASE,
      useValue: { execute: () => Promise.resolve({ id: '' }) } satisfies SuspendPharmacyPort,
    },
    {
      provide: LICENSE_NOTICE_LOG,
      useValue: { tryRecord: () => Promise.resolve(true) } satisfies LicenseNoticeLogPort,
    },
    LicenseExpiryCheckProcessor,
    LicenseExpiryCheckScheduler,
  ],
})
export class LicenseExpiryCheckModule implements OnModuleDestroy {
  constructor(@Inject(LICENSE_EXPIRY_CHECK_QUEUE) private readonly checkQueue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.checkQueue.close()
  }
}
