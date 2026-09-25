import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { productEvents, type ProductEventInsert } from '@/db/schema/product-events.js'
import type { ProductEvent } from '@/modules/analytics/domain/product-event.entity.js'
import {
  PRODUCT_EVENTS_REPOSITORY,
  type AnalyticsPeriodRange,
  type ProductEventsRepositoryPort,
  type WeeklyRealizedSavingsPoint,
} from '@/modules/analytics/application/ports/product-events-repository.port.js'

const SAVINGS_SOURCE_EVENT_TYPES = ['analog_shown', 'added_to_cart'] as const
const TREND_WEEKS = 7

interface WeeklyTrendRow {
  readonly week_label: string
  readonly realized_savings_diram: string
}

@Injectable()
export class ProductEventsRepository implements ProductEventsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async insert(event: ProductEvent): Promise<void> {
    await this.db.insert(productEvents).values(toRow(event))
  }

  public async insertBatch(events: readonly ProductEvent[]): Promise<void> {
    if (events.length === 0) {
      return
    }
    await this.db.insert(productEvents).values(events.map(toRow))
  }

  public async findMatchingSavingsEvents(
    tenantId: string,
    sessionId: string,
    medicineIds: readonly string[],
  ): Promise<ReadonlyMap<string, bigint>> {
    if (medicineIds.length === 0) {
      return new Map()
    }
    const rows = await this.db
      .select({ medicineId: productEvents.medicineId, savingsDiram: productEvents.savingsDiram })
      .from(productEvents)
      .where(
        and(
          eq(productEvents.tenantId, tenantId),
          eq(productEvents.sessionId, sessionId),
          inArray(productEvents.medicineId, [...medicineIds]),
          inArray(productEvents.eventType, [...SAVINGS_SOURCE_EVENT_TYPES]),
          isNotNull(productEvents.savingsDiram),
        ),
      )
      .orderBy(desc(productEvents.occurredAt))
    const out = new Map<string, bigint>()
    for (const row of rows) {
      // Отсортировано по убыванию occurredAt — первое совпадение medicineId уже самое свежее.
      if (row.medicineId !== null && row.savingsDiram !== null && !out.has(row.medicineId)) {
        out.set(row.medicineId, row.savingsDiram)
      }
    }
    return out
  }

  public async countByEventType(
    tenantId: string,
    period: AnalyticsPeriodRange,
    eventTypes: readonly string[],
  ): Promise<Readonly<Record<string, number>>> {
    const out: Record<string, number> = Object.fromEntries(eventTypes.map((type) => [type, 0]))
    if (eventTypes.length === 0) {
      return out
    }
    const rows = await this.db
      .select({ eventType: productEvents.eventType, value: sql<string>`COUNT(*)` })
      .from(productEvents)
      .where(and(...periodConditions(tenantId, period), inArray(productEvents.eventType, [...eventTypes])))
      .groupBy(productEvents.eventType)
    for (const row of rows) {
      out[row.eventType] = Number(row.value)
    }
    return out
  }

  public async sumSavingsByEventType(tenantId: string, period: AnalyticsPeriodRange, eventType: string): Promise<bigint> {
    const rows = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${productEvents.savingsDiram}), 0)` })
      .from(productEvents)
      .where(and(...periodConditions(tenantId, period), eq(productEvents.eventType, eventType)))
    return BigInt(rows[0]?.total ?? '0')
  }

  public async getWeeklyRealizedSavingsTrend(
    tenantId: string,
    period: AnalyticsPeriodRange,
  ): Promise<readonly WeeklyRealizedSavingsPoint[]> {
    // Последняя миллисекунда периода — якорь недели, чтобы выбранное окно попало в ПОСЛЕДНИЙ бар тренда.
    const anchor = new Date(period.end.getTime() - 1)
    const priorWeeksInterval = sql.raw(`interval '${String(TREND_WEEKS - 1)} weeks'`)
    const result = await this.db.execute(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', ${anchor}::timestamptz) - ${priorWeeksInterval},
          date_trunc('week', ${anchor}::timestamptz),
          interval '1 week'
        ) AS week_start
      )
      SELECT
        to_char(w.week_start, 'YYYY-MM-DD') AS week_label,
        COALESCE(SUM(pe.savings_diram), 0)::text AS realized_savings_diram
      FROM weeks w
      LEFT JOIN product_events pe
        ON pe.tenant_id = ${tenantId}
        AND pe.event_type = 'order_placed'
        AND pe.savings_diram IS NOT NULL
        AND date_trunc('week', pe.occurred_at) = w.week_start
      GROUP BY w.week_start
      ORDER BY w.week_start
    `)
    return extractRows(result).map(toWeeklyPoint)
  }
}

function periodConditions(tenantId: string, period: AnalyticsPeriodRange) {
  return [eq(productEvents.tenantId, tenantId), gte(productEvents.occurredAt, period.start), lt(productEvents.occurredAt, period.end)]
}

/** Нормализация `db.execute(...)` для разных драйверов Drizzle — тот же приём, что `audit-log.repository.ts`. */
function extractRows(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) {
    return result
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows
    }
  }
  return []
}

function toWeeklyPoint(row: unknown): WeeklyRealizedSavingsPoint {
  const typed = row as WeeklyTrendRow
  return { weekLabel: typed.week_label, realizedSavingsDiram: BigInt(typed.realized_savings_diram) }
}

function toRow(event: ProductEvent): ProductEventInsert {
  const snapshot = event.toSnapshot()
  return {
    tenantId: snapshot.tenantId,
    userId: snapshot.userId,
    sessionId: snapshot.sessionId,
    eventType: snapshot.eventType,
    medicineId: snapshot.medicineId,
    pharmacyId: snapshot.pharmacyId,
    orderId: snapshot.orderId,
    savingsDiram: snapshot.savingsDiram,
    metadata: snapshot.metadata,
    occurredAt: snapshot.occurredAt,
  }
}

export const PRODUCT_EVENTS_REPOSITORY_PROVIDER = {
  provide: PRODUCT_EVENTS_REPOSITORY,
  useClass: ProductEventsRepository,
} as const
