import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { courierPayouts } from '@/db/schema/courier-payouts.js'
import {
  COURIER_PAYOUTS_REPOSITORY,
  type CourierPayoutRow,
  type CourierPayoutsCursor,
  type CourierPayoutsRepositoryPort,
  type FindCourierPayoutsInput,
  type FindCourierPayoutsResult,
} from '@/modules/delivery/application/ports/courier-payouts.repository.port.js'

const PAYOUTS_SELECTION = {
  id: courierPayouts.id,
  courierId: courierPayouts.courierId,
  periodStart: courierPayouts.periodStart,
  periodEnd: courierPayouts.periodEnd,
  totalAmountDiram: courierPayouts.totalAmountDiram,
  cashRemittanceOffsetDiram: courierPayouts.cashRemittanceOffsetDiram,
  status: courierPayouts.status,
  issuedAt: courierPayouts.issuedAt,
  paidAt: courierPayouts.paidAt,
  createdAt: courierPayouts.createdAt,
} as const

interface PayoutsSelectionRow {
  readonly id: string
  readonly courierId: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly totalAmountDiram: bigint
  readonly cashRemittanceOffsetDiram: bigint
  readonly status: 'draft' | 'issued' | 'paid' | 'failed'
  readonly issuedAt: Date | null
  readonly paidAt: Date | null
  readonly createdAt: Date | null
}

@Injectable()
export class DrizzleCourierPayoutsRepository implements CourierPayoutsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findPage(input: FindCourierPayoutsInput): Promise<FindCourierPayoutsResult> {
    const rows = (await this.db
      .select(PAYOUTS_SELECTION)
      .from(courierPayouts)
      .where(and(...payoutsConditions(input.courierId, input.cursor)))
      .orderBy(desc(courierPayouts.createdAt), desc(courierPayouts.id))
      .limit(input.limit + 1)) as PayoutsSelectionRow[]
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toCourierPayoutRow),
      nextCursor: hasMore && last !== undefined ? { v: cursorCreatedAt(last.createdAt).toISOString(), id: last.id } : null,
      hasMore,
    }
  }
}

function payoutsConditions(courierId: string | null, cursor: CourierPayoutsCursor | null) {
  const conditions = courierId === null ? [] : [eq(courierPayouts.courierId, courierId)]
  if (cursor !== null) {
    const cursorCreatedAtValue = new Date(cursor.v)
    const keysetCondition = or(
      lt(courierPayouts.createdAt, cursorCreatedAtValue),
      and(eq(courierPayouts.createdAt, cursorCreatedAtValue), lt(courierPayouts.id, cursor.id)),
    )
    if (keysetCondition !== undefined) {
      conditions.push(keysetCondition)
    }
  }
  return conditions
}

function cursorCreatedAt(createdAt: Date | null): Date {
  return createdAt ?? new Date(0)
}

function toCourierPayoutRow(row: PayoutsSelectionRow): CourierPayoutRow {
  return {
    id: row.id,
    courierId: row.courierId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    totalAmountDiram: row.totalAmountDiram,
    cashRemittanceOffsetDiram: row.cashRemittanceOffsetDiram,
    status: row.status,
    issuedAt: row.issuedAt,
    paidAt: row.paidAt,
  }
}

export const COURIER_PAYOUTS_REPOSITORY_PROVIDER = {
  provide: COURIER_PAYOUTS_REPOSITORY,
  useClass: DrizzleCourierPayoutsRepository,
} as const
