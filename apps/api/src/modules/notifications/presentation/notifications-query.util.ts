/**
 * Обработка query-параметров `filter[status]` и курсора для `notifications-feed.controller.ts`
 * (DTJ-372). Курсор декодирует `decodeCursor` из `@dorutj/contracts` (DTJ-005).
 *
 * `filter[status]` — bracket-синтаксис как ЛИТЕРАЛЬНОЕ имя query-параметра (Fastify default
 * querystring НЕ разворачивает `a[b]` во вложенный объект), прямой прецедент —
 * `pharmacy-terminal-queue.controller.ts` (`filter[pharmacyId]`, DTJ-159).
 *
 * Ошибки валидации — доменные (`ValidationError`/`InvalidCursorError`), брошены НАПРЯМУЮ,
 * без обёртки в `BadRequestException`: `AllExceptionsFilter` (`@Catch()`) перехватывает `DomainError`
 * из ЛЮБОГО места пайплайна запроса — обёртка не нужна.
 */
import { decodeCursor, InvalidCursorError, NOTIFICATION_STATUS_VALUES, ValidationError } from '@dorutj/contracts'
import type { ListNotificationsCursor, NotificationStatus } from '../application/ports/notifications-repository.port.js'

function isNotificationStatus(value: string): value is NotificationStatus {
  return (NOTIFICATION_STATUS_VALUES as readonly string[]).includes(value)
}

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
  const invalid = statuses.find((status) => !isNotificationStatus(status))
  if (invalid !== undefined) {
    throw new ValidationError(`Invalid status: "${invalid}"`, { status: invalid })
  }
  return statuses.filter(isNotificationStatus)
}
