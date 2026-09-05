/**
 * `DrizzleSupportUnitOfWorkAdapter` (EP-14, DTJ-279) — production-реализация
 * `SupportUnitOfWorkPort` через `db.transaction(...)`, 1:1 паттерн `payments/infrastructure/
 * adapters/drizzle-payments-unit-of-work.adapter.ts` (DTJ-242).
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import {
  SUPPORT_UNIT_OF_WORK,
  type SupportUnitOfWorkCallback,
  type SupportUnitOfWorkPort,
} from '@/modules/support/application/ports/support-unit-of-work.port.js'

@Injectable()
export class DrizzleSupportUnitOfWorkAdapter implements SupportUnitOfWorkPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async run<T>(callback: SupportUnitOfWorkCallback<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx))
  }
}

export const SUPPORT_UNIT_OF_WORK_DRIZZLE_PROVIDER = {
  provide: SUPPORT_UNIT_OF_WORK,
  useClass: DrizzleSupportUnitOfWorkAdapter,
} as const
