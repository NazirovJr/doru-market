/**
 * `OrderQueueSortPolicy` (DTJ-301, EP-12, модуль 24 «Терминал фармацевта», SRS-PHT-005) —
 * `sort=priority` резолвится В APPLICATION, НЕ полем БД (буквальный текст тикета/спеки): (1)
 * заказы `status='processing'` — по `sla_deadline_at ASC NULLS LAST` (ближе к просрочке — выше);
 * (2) заказы `status IN ('paid_escrow','confirmed')` (ещё не приняты фармацевтом — обе ветки
 * D-25, non-cash/cash_courier) — по `created_at ASC` (FIFO), ВСЕГДА ПОСЛЕ группы 1.
 *
 * Чистая функция, без побочных эффектов и портов (домен/application этого модуля НЕ импортирует
 * `drizzle-orm`/`@nestjs/*`) — тот же стиль, что `checkout.util.ts`/`calculate-order-cost.service.ts`
 * (свободные функции, не класс с DI-зависимостями — сортировке они не нужны).
 *
 * `cursorValue` экспортирован ОТДЕЛЬНО от `sort` — `GetOrderQueueUseCase` строит курсор
 * пагинации (`meta.pagination.nextCursor`) из ТОГО ЖЕ ключа, которым массив отсортирован: иначе
 * курсор и порядок сортировки могли бы разойтись, если правило поменяется в одном месте, но не
 * в другом.
 */
import type { OrderQueueRow } from '@/modules/orders/application/ports/order-repository.port.js'

/** NULLS LAST для `slaDeadlineAt` внутри группы `processing` — сентинел «позже любой реальной даты». */
const NULL_SLA_DEADLINE_SENTINEL = '9999-12-31T23:59:59.999Z'

export const OrderQueueSortPolicy = {
  /** Возвращает НОВЫЙ отсортированный массив (не мутирует вход) — по возрастанию `cursorValue`. */
  sort(rows: readonly OrderQueueRow[]): readonly OrderQueueRow[] {
    return [...rows].sort((a, b) => compareCursorValues(cursorValue(a), cursorValue(b)))
  },

  /**
   * Опаковый строковый ключ, монотонный относительно правила приоритета выше — сравним
   * лексикографически (используется И для сортировки, И как значение курсора пагинации, см.
   * JSDoc файла). Формат `${groupRank}#${ISO-время}#${orderId}` — ISO-8601 сортируется
   * лексикографически хронологически, `orderId` в хвосте — детерминированный тай-брейк при
   * совпадении времени (id всегда уникален).
   */
  cursorValue(row: OrderQueueRow): string {
    return cursorValue(row)
  },
}

function cursorValue(row: OrderQueueRow): string {
  const isProcessing = row.status === 'processing'
  const groupRank = isProcessing ? '0' : '1'
  const timeIso = isProcessing ? (row.slaDeadlineAt?.toISOString() ?? NULL_SLA_DEADLINE_SENTINEL) : row.createdAt.toISOString()
  return `${groupRank}#${timeIso}#${row.id}`
}

function compareCursorValues(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
