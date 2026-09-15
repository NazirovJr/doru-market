/**
 * `DrizzleReturnsUnitOfWorkAdapter` (EP-11, DTJ-273) — production-реализация
 * `ReturnsUnitOfWorkPort` через `db.transaction(...)`, 1:1 паттерн `support/infrastructure/
 * adapters/drizzle-support-unit-of-work.adapter.ts` (DTJ-279).
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import {
  RETURNS_UNIT_OF_WORK,
  type ReturnsUnitOfWorkCallback,
  type ReturnsUnitOfWorkPort,
} from '@/modules/returns/application/ports/returns-unit-of-work.port.js'

@Injectable()
export class DrizzleReturnsUnitOfWorkAdapter implements ReturnsUnitOfWorkPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async run<T>(callback: ReturnsUnitOfWorkCallback<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx))
  }
}

export const RETURNS_UNIT_OF_WORK_DRIZZLE_PROVIDER = {
  provide: RETURNS_UNIT_OF_WORK,
  useClass: DrizzleReturnsUnitOfWorkAdapter,
} as const
