/**
 * Обработка query-параметров `filter[status]` и курсора для `notifications-feed.controller.ts`
 * (DTJ-372). Переиспользует `cursorQuerySchema`/`decodeCursor` из `@dorutj/contracts` (DTJ-005).
 *
 * `filter[status]` — bracket-синтаксис как ЛИТЕРАЛЬНОЕ имя query-параметра (Fastify default
 * querystring НЕ разворачивает `a[b]` в вложенный объект), прямой прецедент —
 * `pharmacy-terminal-queue.controller.ts` (`filter[pharmacyId]`, DTJ-159).
 *
 * Ошибки валидации — доменные (`ValidationError`/`InvalidCursorError`), брошены НАПРЯМУЖУ,
 * без обёртки в `BadRequestException`: `AllExceptionsFilter` (`@Catch()`) перехватывает `DomainError`
 * из ЛЮБОГО места пайплайна запроса — обёртка не нужна.
 */
import { decodeCursor, InvalidCursorError, ValidationError } from '@dorutj/contracts'
import type { ListNotificationsCursor, NotificationStatus } from '../application/ports/notifications-repository.port.js'
import { NOTIFICATION_STATUS_VALUES } from '@dorutj/contracts'

export function parseListCursor(raw: string | undefined): ListNotificationsCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

/** `parseStatusFilter` — `filter[status]=queued,sent` → `['queued', 'sent']`. */
export function parseStatusFilter(raw: string | undefined): readonly NotificationStatus[] | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined
  }
  const statuses = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (statuses.length === 0) {
    return undefined
  }
  for (const status of statuses) {
    if (!NOTIFICATION_STATUS_VALUES.includes(status as NotificationStatus)) {
      throw new ValidationError(`Invalid status: "${status}"`, { status })
    }
  }
  return statuses as readonly NotificationStatus[]
}
