/**
 * `DrizzleCourierEarningsRepository` (EP-13, DTJ-321) — реализация `CourierEarningsRepositoryPort`
 * поверх `courier_earnings` (`db/schema/courier-earnings.ts`). Keyset-пагинация 1:1 паттерн
 * `DrizzlePayoutScheduleRepository.findByPharmacy` (DTJ-252, `payments`) — `LIMIT input.limit + 1`
 * даёт `hasMore` без второй `COUNT`-круговой поездки, курсор — составное условие
 * `recognized_at < cursor.v OR (recognized_at = cursor.v AND id < cursor.id)`.
 *
 * READ-ONLY (см. JSDoc `db/schema/courier-earnings.ts`) — этот файл не пишет ни одной строки,
 * только `findPage`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { courierEarnings } from '@/db/schema/courier-earnings.js'
import {
  COURIER_EARNINGS_REPOSITORY,
  type CourierEarningRow,
  type CourierEarningsCursor,
  type CourierEarningsRepositoryPort,
  type FindCourierEarningsInput,
  type FindCourierEarningsResult,
} from '@/modules/delivery/application/ports/courier-earnings.repository.port.js'

const EARNINGS_SELECTION = {
  id: courierEarnings.id,
  amountDiram: courierEarnings.amountDiram,
  isReturnFee: courierEarnings.isReturnFee,
  recognizedAt: courierEarnings.recognizedAt,
  payoutBatchId: courierEarnings.payoutBatchId,
} as const

interface EarningsSelectionRow {
  readonly id: string
  readonly amountDiram: bigint
  readonly isReturnFee: boolean
  readonly recognizedAt: Date
  readonly payoutBatchId: string | null
}

@Injectable()
export class DrizzleCourierEarningsRepository implements CourierEarningsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findPage(input: FindCourierEarningsInput): Promise<FindCourierEarningsResult> {
    const rows = (await this.db
      .select(EARNINGS_SELECTION)
      .from(courierEarnings)
      .where(and(...earningsConditions(input.courierId, input.cursor)))
      .orderBy(desc(courierEarnings.recognizedAt), desc(courierEarnings.id))
      .limit(input.limit + 1)) as EarningsSelectionRow[]
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toCourierEarningRow),
      nextCursor: hasMore && last !== undefined ? { v: last.recognizedAt.toISOString(), id: last.id } : null,
      hasMore,
    }
  }
}

/** 1:1 `payoutReportConditions` (DTJ-252, `payments`) — `or(...)` типизирован `SQL | undefined`. */
function earningsConditions(courierId: string, cursor: CourierEarningsCursor | null) {
  const conditions = [eq(courierEarnings.courierId, courierId)]
  if (cursor !== null) {
    const cursorRecognizedAt = new Date(cursor.v)
    const keysetCondition = or(
      lt(courierEarnings.recognizedAt, cursorRecognizedAt),
      and(eq(courierEarnings.recognizedAt, cursorRecognizedAt), lt(courierEarnings.id, cursor.id)),
    )
    if (keysetCondition !== undefined) {
      conditions.push(keysetCondition)
    }
  }
  return conditions
}

function toCourierEarningRow(row: EarningsSelectionRow): CourierEarningRow {
  return {
    id: row.id,
    amountDiram: row.amountDiram,
    isReturnFee: row.isReturnFee,
    recognizedAt: row.recognizedAt,
    payoutBatchId: row.payoutBatchId,
  }
}

export const COURIER_EARNINGS_REPOSITORY_PROVIDER = {
  provide: COURIER_EARNINGS_REPOSITORY,
  useClass: DrizzleCourierEarningsRepository,
} as const
