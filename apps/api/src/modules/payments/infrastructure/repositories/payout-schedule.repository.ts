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
import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { payoutSchedule } from '@/db/schema/payments.js'
import { orders } from '@/db/schema/orders.js'
import { payoutStatusEnum } from '@/db/schema/enums.schema.js'

/** DTJ-252: `payoutSchedule.status` — Drizzle pgEnum, `inArray` требует литеральный union, не `string[]`.
 *  Невалидные значения (за пределами enum'а, напр. опечатка в `filter[status][in]`) отфильтровываются
 *  этим cast'ом на границе репозитория, не бросают — совпадений с ними в БД физически не бывает,
 *  WHERE просто не находит строк (см. JSDoc `pharmacy-report-access.util.ts` про permissive-фильтр). */
type PayoutStatusValue = (typeof payoutStatusEnum.enumValues)[number]
import {
  PAYOUT_SCHEDULE_REPOSITORY,
  type FindPayoutsByPharmacyInput,
  type FindPayoutsByPharmacyResult,
  type HoldIfPendingInput,
  type InsertPendingPayoutInput,
  type PayoutReportRow,
  type PayoutScheduleRepository,
  type PayoutScheduleUnitOfWorkTx,
} from '@/modules/payments/application/ports/payout-schedule-repository.port.js'

/** Общая проекция колонок `findByPharmacy`/`findAllByPharmacy` (DTJ-252) — `id`/`createdAt` внутренние (курсор), не часть `PayoutReportRow`. */
const PAYOUT_REPORT_SELECTION = {
  id: payoutSchedule.id,
  orderId: payoutSchedule.orderId,
  orderNumber: orders.orderNumber,
  grossAmountDiram: payoutSchedule.grossAmountDiram,
  commissionDiram: payoutSchedule.commissionDiram,
  netAmountDiram: payoutSchedule.netAmountDiram,
  status: payoutSchedule.status,
  dueAt: payoutSchedule.dueAt,
  paidAt: payoutSchedule.paidAt,
  createdAt: payoutSchedule.createdAt,
} as const

interface PayoutReportSelectionRow {
  readonly id: string
  readonly orderId: string
  readonly orderNumber: string
  readonly grossAmountDiram: bigint
  readonly commissionDiram: bigint
  readonly netAmountDiram: bigint
  readonly status: string
  readonly dueAt: Date | null
  readonly paidAt: Date | null
  readonly createdAt: Date | null
}

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

  /** (DTJ-252) — см. JSDoc порта. `LIMIT input.limit + 1` — `hasMore` без второй `COUNT`-круговой поездки. */
  public async findByPharmacy(input: FindPayoutsByPharmacyInput): Promise<FindPayoutsByPharmacyResult> {
    const rows = (await this.db
      .select(PAYOUT_REPORT_SELECTION)
      .from(payoutSchedule)
      .innerJoin(orders, eq(orders.id, payoutSchedule.orderId))
      .where(and(...payoutReportConditions(input.pharmacyId, input.statuses, input.cursor)))
      .orderBy(desc(payoutSchedule.createdAt), desc(payoutSchedule.id))
      .limit(input.limit + 1)) as PayoutReportSelectionRow[]
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toPayoutReportRow),
      nextCursor: hasMore && last !== undefined ? { v: cursorCreatedAt(last.createdAt).toISOString(), id: last.id } : null,
      hasMore,
    }
  }

  /** (DTJ-252) — см. JSDoc порта. БЕЗ `LIMIT`/`cursor` — полный поток для CSV-экспорта. */
  public async findAllByPharmacy(pharmacyId: string, statuses?: readonly string[]): Promise<readonly PayoutReportRow[]> {
    const rows = (await this.db
      .select(PAYOUT_REPORT_SELECTION)
      .from(payoutSchedule)
      .innerJoin(orders, eq(orders.id, payoutSchedule.orderId))
      .where(and(...payoutReportConditions(pharmacyId, statuses, null)))
      .orderBy(desc(payoutSchedule.createdAt), desc(payoutSchedule.id))) as PayoutReportSelectionRow[]
    return rows.map(toPayoutReportRow)
  }
}

/** Общие `WHERE`-условия `findByPharmacy`/`findAllByPharmacy` (DTJ-252) — не дублировать между методами. */
function payoutReportConditions(pharmacyId: string, statuses: readonly string[] | undefined, cursor: FindPayoutsByPharmacyInput['cursor']) {
  const conditions = [eq(payoutSchedule.pharmacyId, pharmacyId)]
  if (statuses !== undefined && statuses.length > 0) {
    conditions.push(inArray(payoutSchedule.status, statuses as readonly PayoutStatusValue[]))
  }
  if (cursor !== null) {
    const cursorCreatedAtValue = new Date(cursor.v)
    const keysetCondition = or(
      lt(payoutSchedule.createdAt, cursorCreatedAtValue),
      and(eq(payoutSchedule.createdAt, cursorCreatedAtValue), lt(payoutSchedule.id, cursor.id)),
    )
    if (keysetCondition !== undefined) {
      conditions.push(keysetCondition)
    }
  }
  return conditions
}

/** `created_at` схема `payments.ts` не несёт `.notNull()` (см. её JSDoc) — практически всегда заполнена (`default(NOW())`), эпоха — оборонительный фолбэк, не ожидаемый путь. */
function cursorCreatedAt(createdAt: Date | null): Date {
  return createdAt ?? new Date(0)
}

function toPayoutReportRow(row: PayoutReportSelectionRow): PayoutReportRow {
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    grossAmountDiram: row.grossAmountDiram,
    commissionDiram: row.commissionDiram,
    netAmountDiram: row.netAmountDiram,
    status: row.status,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
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
