/**
 * `DrizzlePayoutScheduleRepository` (EP-10, DTJ-245) — реализация `PayoutScheduleRepository`
 * поверх `payout_schedule` (`db/schema/payments.ts`, DTJ-236). Тот же тенант-скоуп приём, что
 * `DrizzleEscrowLedgerRepository.orderBelongsToTenant` (DTJ-240, принято CTO): `payout_schedule`
 * не несёт своей колонки `tenant_id` — скоуп через `EXISTS`-подзапрос против `orders`. Чтение
 * ЧУЖОЙ Drizzle-схемы (`orders`) из своего `infrastructure` — не межмодульный deep-import
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1 запрещает импорт `domain`/`application` чужого
 * модуля, не импорт таблицы).
 *
 * `reverseIfExists` — один `UPDATE ... WHERE status <> 'reversed' RETURNING id`: идемпотентно
 * без отдельного `SELECT`-проверки перед записью (одна круговая поездка, не check-then-write).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, ne, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { payoutSchedule } from '@/db/schema/payments.js'
import { orders } from '@/db/schema/orders.js'
import {
  PAYOUT_SCHEDULE_REPOSITORY,
  type PayoutScheduleRepository,
  type PayoutScheduleUnitOfWorkTx,
} from '@/modules/payments/application/ports/payout-schedule-repository.port.js'

const REVERSED_STATUS = 'reversed'

@Injectable()
export class DrizzlePayoutScheduleRepository implements PayoutScheduleRepository {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async reverseIfExists(tenantId: string, orderId: string, tx?: PayoutScheduleUnitOfWorkTx): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const updated = await client
      .update(payoutSchedule)
      .set({ status: REVERSED_STATUS, updatedAt: sql`NOW()` })
      .where(
        and(
          eq(payoutSchedule.orderId, orderId),
          ne(payoutSchedule.status, REVERSED_STATUS),
          orderBelongsToTenant(tenantId, orderId),
        ),
      )
      .returning({ id: payoutSchedule.id })
    return updated.length > 0
  }
}

/** См. JSDoc файла — тот же приём, что `escrow-ledger.repository.ts` (`orderBelongsToTenant`). */
function orderBelongsToTenant(tenantId: string, orderId: string): ReturnType<typeof sql> {
  return sql`EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.id} = ${orderId} AND ${orders.tenantId} = ${tenantId})`
}

/** См. JSDoc `orders/infrastructure/repositories/drizzle-tx.util.ts` — тот же паттерн. */
function resolveDrizzleClient(db: DrizzleDb, tx: PayoutScheduleUnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}

export const PAYOUT_SCHEDULE_REPOSITORY_PROVIDER = {
  provide: PAYOUT_SCHEDULE_REPOSITORY,
  useClass: DrizzlePayoutScheduleRepository,
} as const
