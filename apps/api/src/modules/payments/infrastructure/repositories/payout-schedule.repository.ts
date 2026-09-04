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
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { payoutSchedule } from '@/db/schema/payments.js'
import { orders } from '@/db/schema/orders.js'
import {
  PAYOUT_SCHEDULE_REPOSITORY,
  type HoldIfPendingInput,
  type InsertPendingPayoutInput,
  type PayoutScheduleRepository,
  type PayoutScheduleUnitOfWorkTx,
} from '@/modules/payments/application/ports/payout-schedule-repository.port.js'

const REVERSED_STATUS = 'reversed'
const PENDING_STATUS = 'pending'
const DUE_STATUS = 'due'
const DISPUTED_STATUS = 'disputed'
/** (DTJ-249) — статусы, из которых `holdIfPending` разрешает переход в `disputed`. */
const HOLDABLE_STATUSES = [PENDING_STATUS, DUE_STATUS] as const

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

  /** (DTJ-244) — см. JSDoc порта: `ON CONFLICT (order_id) DO NOTHING`, не ошибка на двойной доставке. */
  public async insertPending(input: InsertPendingPayoutInput, tx?: PayoutScheduleUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    await client
      .insert(payoutSchedule)
      .values({
        orderId: input.orderId,
        pharmacyId: input.pharmacyId,
        status: PENDING_STATUS,
        grossAmountDiram: input.grossAmountDiram,
        commissionDiram: input.commissionDiram,
        netAmountDiram: input.netAmountDiram,
        holdPeriodDays: input.holdPeriodDays,
      })
      .onConflictDoNothing({ target: payoutSchedule.orderId })
  }

  /** (DTJ-249) — см. JSDoc порта `holdIfPending`. */
  public async holdIfPending(input: HoldIfPendingInput, tx?: PayoutScheduleUnitOfWorkTx): Promise<{ held: boolean }> {
    const client = resolveDrizzleClient(this.db, tx)
    const updated = await client
      .update(payoutSchedule)
      .set({ status: DISPUTED_STATUS, heldByDisputeId: input.disputeId, updatedAt: sql`NOW()` })
      .where(
        and(
          eq(payoutSchedule.orderId, input.orderId),
          inArray(payoutSchedule.status, HOLDABLE_STATUSES),
          orderBelongsToTenant(input.tenantId, input.orderId),
        ),
      )
      .returning({ id: payoutSchedule.id })
    return { held: updated.length > 0 }
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
