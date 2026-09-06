/**
 * `sla-status.ts` (DTJ-283) — ЧИСТЫЕ функции вычисления SLA-состояния тикета, отдельно от
 * рендера (`SlaBadge.tsx`) и от сортировки очереди (`SupportTicketQueue.tsx`) — ticket «Что
 * сделать» п.2/п.4: «вычисляется в model/, не на сервере» + «unit-тест чистой функции вычисления
 * состояния, отдельно от рендера бейджа» (тест-план).
 *
 * `firstResponseDueAt`/`firstRespondedAt` — уже отдаются сервером (`SupportTicketDto`, DTJ-282),
 * доп. эндпоинт не нужен (см. JSDoc `use-support-tickets.ts`).
 */
import type { SupportTicketDto } from '@dorutj/contracts'

export type SlaState = 'ok' | 'warning' | 'overdue' | 'responded'

const MS_PER_MINUTE = 60_000
/** Порог «жёлтого» состояния — < 15 минут до дедлайна первого ответа (DTJ-283 «Что сделать» п.3). */
const SLA_WARNING_THRESHOLD_MINUTES = 15
const SLA_WARNING_THRESHOLD_MS = SLA_WARNING_THRESHOLD_MINUTES * MS_PER_MINUTE

/** Ранг срочности состояния для сортировки очереди (меньше — срочнее, выше в списке). */
const SLA_URGENCY_RANK: Readonly<Record<SlaState, number>> = { overdue: 0, warning: 1, ok: 2, responded: 3 }

export interface SlaTicketLike {
  readonly firstResponseDueAt: string | null
  readonly firstRespondedAt: string | null
}

/**
 * SRS-ADM-075/076-подобный принцип: `responded` — уже есть первый ответ (нейтрально, SLA больше
 * не актуален для ЭТОГО измерения). Иначе — `overdue`/`warning`/`ok` по дистанции до дедлайна.
 * `firstResponseDueAt === null` (теоретически возможно, если тенант не настроил SLA) → `ok`
 * (не «неизвестно» — не показывать ложную тревогу без реального дедлайна).
 */
export function computeSlaState(ticket: SlaTicketLike, now: Date = new Date()): SlaState {
  if (ticket.firstRespondedAt !== null) {
    return 'responded'
  }
  if (ticket.firstResponseDueAt === null) {
    return 'ok'
  }
  const msUntilDue = new Date(ticket.firstResponseDueAt).getTime() - now.getTime()
  if (msUntilDue <= 0) {
    return 'overdue'
  }
  return msUntilDue <= SLA_WARNING_THRESHOLD_MS ? 'warning' : 'ok'
}

/** DTJ-283 «Что сделать» п.2 — фильтр «только просроченные»: `firstResponseDueAt < now() && !firstRespondedAt`. */
export function isOverdue(ticket: SlaTicketLike, now: Date = new Date()): boolean {
  return computeSlaState(ticket, now) === 'overdue'
}

/**
 * DTJ-283 АС1 — просроченные + высокий приоритет первыми. Сортировка ПО СОСТОЯНИЮ (overdue <
 * warning < ok < responded), внутри одного состояния — по убыванию `priority` (эскалированные
 * джобой DTJ-280 тикеты выше неэскалированных с тем же состоянием).
 */
export function compareByUrgency(a: SupportTicketDto, b: SupportTicketDto, now: Date = new Date()): number {
  const rankDiff = SLA_URGENCY_RANK[computeSlaState(a, now)] - SLA_URGENCY_RANK[computeSlaState(b, now)]
  return rankDiff !== 0 ? rankDiff : b.priority - a.priority
}
