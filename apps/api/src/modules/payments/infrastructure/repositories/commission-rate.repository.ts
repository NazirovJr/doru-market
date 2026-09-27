// DrizzleCommissionRateRepository (DTJ-358) — тот же keyset-приём (created_at DESC, id DESC, LIMIT+1), что DrizzlePayoutScheduleRepository.findSchedule.
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { platformFee } from '@/db/schema/payments.js'
import {
  COMMISSION_RATE_REPOSITORY,
  type CommissionRateRepository,
  type CommissionRateRow,
  type CommissionRateWriteFields,
  type FindCommissionRatesFilter,
  type FindCommissionRatesInput,
  type FindCommissionRatesResult,
  type UpdateCommissionRateInput,
} from '@/modules/payments/application/ports/commission-rate-repository.port.js'

const SELECTION = {
  id: platformFee.id,
  tenantId: platformFee.tenantId,
  chainId: platformFee.chainId,
  category: platformFee.commissionCategory,
  rateBps: platformFee.commissionBps,
  effectiveFrom: platformFee.effectiveFrom,
  effectiveTo: platformFee.effectiveTo,
  createdBy: platformFee.createdBy,
  createdAt: platformFee.createdAt,
} as const

interface SelectionRow {
  readonly id: string
  readonly tenantId: string | null
  readonly chainId: string | null
  readonly category: string | null
  readonly rateBps: number
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdBy: string
  readonly createdAt: Date | null
}

/** `created_at` не несёт `.notNull()` в схеме — эпоха как оборонительный фолбэк курсора, не ожидаемый путь. */
function cursorCreatedAt(createdAt: Date | null): Date {
  return createdAt ?? new Date(0)
}

function toRow(row: SelectionRow): CommissionRateRow {
  return { ...row }
}

function findConditions(filter: FindCommissionRatesFilter, cursor: FindCommissionRatesInput['cursor']) {
  const conditions = []
  if (filter.tenantId !== undefined) {
    conditions.push(eq(platformFee.tenantId, filter.tenantId))
  }
  if (filter.chainId !== undefined) {
    conditions.push(eq(platformFee.chainId, filter.chainId))
  }
  if (filter.category !== undefined) {
    conditions.push(eq(platformFee.commissionCategory, filter.category))
  }
  if (cursor !== null) {
    const cursorCreatedAtValue = new Date(cursor.v)
    const keysetCondition = or(
      lt(platformFee.createdAt, cursorCreatedAtValue),
      and(eq(platformFee.createdAt, cursorCreatedAtValue), lt(platformFee.id, cursor.id)),
    )
    if (keysetCondition !== undefined) {
      conditions.push(keysetCondition)
    }
  }
  return conditions
}

@Injectable()
export class DrizzleCommissionRateRepository implements CommissionRateRepository {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findMany(input: FindCommissionRatesInput): Promise<FindCommissionRatesResult> {
    const rows = (await this.db
      .select(SELECTION)
      .from(platformFee)
      .where(and(...findConditions(input, input.cursor)))
      .orderBy(desc(platformFee.createdAt), desc(platformFee.id))
      .limit(input.limit + 1)) as SelectionRow[]
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toRow),
      nextCursor: hasMore && last !== undefined ? { v: cursorCreatedAt(last.createdAt).toISOString(), id: last.id } : null,
      hasMore,
    }
  }

  public async insert(input: CommissionRateWriteFields): Promise<CommissionRateRow> {
    const [row] = (await this.db
      .insert(platformFee)
      .values({
        tenantId: input.tenantId,
        chainId: input.chainId,
        commissionCategory: input.category,
        commissionBps: input.rateBps,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        createdBy: input.createdBy,
      })
      .returning(SELECTION)) as SelectionRow[]
    if (row === undefined) {
      throw new Error('platform_fee insert returned no row')
    }
    return toRow(row)
  }

  public async update(input: UpdateCommissionRateInput): Promise<CommissionRateRow | null> {
    const rows = (await this.db
      .update(platformFee)
      .set({
        tenantId: input.tenantId,
        chainId: input.chainId,
        commissionCategory: input.category,
        commissionBps: input.rateBps,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
      })
      .where(eq(platformFee.id, input.id))
      .returning(SELECTION)) as SelectionRow[]
    const row = rows[0]
    return row === undefined ? null : toRow(row)
  }
}

export const COMMISSION_RATE_REPOSITORY_PROVIDER = {
  provide: COMMISSION_RATE_REPOSITORY,
  useClass: DrizzleCommissionRateRepository,
} as const
