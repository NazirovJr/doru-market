// DTJ-381 — воронка «показ экономии → клик → корзина → заказ» (kill-критерий №1 пивота).
import { Inject, Injectable } from '@nestjs/common'
import { ValidationError } from '@dorutj/contracts'
import { PRODUCT_EVENT_TYPES } from '../../domain/product-event.entity.js'
import {
  PRODUCT_EVENTS_REPOSITORY,
  type AnalyticsPeriodRange,
  type ProductEventsRepositoryPort,
  type WeeklyRealizedSavingsPoint,
} from '../ports/product-events-repository.port.js'

const SHOWN_EVENT_TYPE = 'analog_shown'
const REALIZED_EVENT_TYPE = 'order_placed'
const MS_PER_DAY = 86_400_000
const DAYS_PER_WEEK = 7
const MIN_ISO_WEEK = 1
const MAX_ISO_WEEK = 53
const MIN_MONTH = 1
const MAX_MONTH = 12
const ISO_WEEK1_ANCHOR_DAY = 4 // 4 января ISO 8601 всегда лежит в неделе 1

const MONTH_PERIOD_PATTERN = /^(\d{4})-(\d{2})$/
const WEEK_PERIOD_PATTERN = /^(\d{4})-W(\d{2})$/

export interface GetFunnelInput {
  readonly tenantId: string
  readonly period: string
}

export interface FunnelConversionRates {
  readonly shownToClicked: number
  readonly clickedToCart: number
  readonly cartToOrder: number
  readonly overallShownToOrder: number
}

export interface GetFunnelResult {
  readonly searchPerformed: number
  readonly analogShown: number
  readonly analogClicked: number
  readonly addedToCart: number
  readonly orderPlaced: number
  readonly conversionRates: FunnelConversionRates
  readonly totalSavingsShownDiram: bigint
  readonly totalSavingsRealizedDiram: bigint
  readonly weeklyTrend: readonly WeeklyRealizedSavingsPoint[]
}

@Injectable()
export class GetFunnelUseCase {
  public constructor(@Inject(PRODUCT_EVENTS_REPOSITORY) private readonly repository: ProductEventsRepositoryPort) {}

  public async execute(input: GetFunnelInput): Promise<GetFunnelResult> {
    const range = parsePeriod(input.period)
    const [counts, totalSavingsShownDiram, totalSavingsRealizedDiram, weeklyTrend] = await Promise.all([
      this.repository.countByEventType(input.tenantId, range, PRODUCT_EVENT_TYPES),
      this.repository.sumSavingsByEventType(input.tenantId, range, SHOWN_EVENT_TYPE),
      this.repository.sumSavingsByEventType(input.tenantId, range, REALIZED_EVENT_TYPE),
      this.repository.getWeeklyRealizedSavingsTrend(input.tenantId, range),
    ])
    return {
      searchPerformed: counts.search_performed ?? 0,
      analogShown: counts.analog_shown ?? 0,
      analogClicked: counts.analog_clicked ?? 0,
      addedToCart: counts.added_to_cart ?? 0,
      orderPlaced: counts.order_placed ?? 0,
      conversionRates: buildConversionRates(counts),
      totalSavingsShownDiram,
      totalSavingsRealizedDiram,
      weeklyTrend,
    }
  }
}

function buildConversionRates(counts: Readonly<Record<string, number>>): FunnelConversionRates {
  const shown = counts.analog_shown ?? 0
  const clicked = counts.analog_clicked ?? 0
  const cart = counts.added_to_cart ?? 0
  const order = counts.order_placed ?? 0
  return {
    shownToClicked: safeDivide(clicked, shown),
    clickedToCart: safeDivide(cart, clicked),
    cartToOrder: safeDivide(order, cart),
    overallShownToOrder: safeDivide(order, shown),
  }
}

// Пустые первые недели пилота (риск тикета) — 0/0 обязан быть 0, не NaN/Infinity.
function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

/** `YYYY-MM` (месяц) или `YYYY-Www` (неделя ISO 8601, понедельник-старт) — единственная точка парсинга периода воронки. */
export function parsePeriod(period: string): AnalyticsPeriodRange {
  const monthMatch = MONTH_PERIOD_PATTERN.exec(period)
  if (monthMatch !== null) {
    return monthPeriodRange(monthMatch)
  }
  const weekMatch = WEEK_PERIOD_PATTERN.exec(period)
  if (weekMatch !== null) {
    return weekPeriodRange(weekMatch)
  }
  throw new ValidationError(`Invalid period format: "${period}" (expected YYYY-MM or YYYY-Www)`, { period })
}

function monthPeriodRange(match: RegExpExecArray): AnalyticsPeriodRange {
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < MIN_MONTH || month > MAX_MONTH) {
    throw new ValidationError(`Invalid month in period: "${match[0]}"`, { period: match[0] })
  }
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) }
}

function weekPeriodRange(match: RegExpExecArray): AnalyticsPeriodRange {
  const year = Number(match[1])
  const week = Number(match[2])
  if (week < MIN_ISO_WEEK || week > MAX_ISO_WEEK) {
    throw new ValidationError(`Invalid ISO week in period: "${match[0]}"`, { period: match[0] })
  }
  const start = isoWeekStart(year, week)
  return { start, end: new Date(start.getTime() + DAYS_PER_WEEK * MS_PER_DAY) }
}

/** Понедельник недели `week` ISO-года `year`. */
function isoWeekStart(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, ISO_WEEK1_ANCHOR_DAY))
  const jan4IsoWeekday = jan4.getUTCDay() === 0 ? DAYS_PER_WEEK : jan4.getUTCDay()
  const week1Monday = new Date(jan4.getTime() - (jan4IsoWeekday - 1) * MS_PER_DAY)
  return new Date(week1Monday.getTime() + (week - 1) * DAYS_PER_WEEK * MS_PER_DAY)
}
