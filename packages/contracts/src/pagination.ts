/**
 * Cursor-пагинация (`docs/spec/12-api-conventions-auth-tenancy.md` §1.1, SRS-API-004/005), DTJ-005.
 *
 * Курсор — непрозрачная для клиента строка `base64url(JSON.stringify({ v, id }))`: `v` — значение
 * поля сортировки последней строки предыдущей страницы, `id` — её идентификатор (keyset pagination,
 * не offset — устраняет дубли/пропуски строк при вставках между запросами).
 */
import { z } from 'zod'

const MIN_LIMIT = 1
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

/** Query-схема, переиспользуемая каждым списковым эндпоинтом (`limit=101` → `400 VALIDATION_ERROR`, не молчаливое обрезание). */
export const cursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(MIN_LIMIT).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
})

export type CursorQuery = z.infer<typeof cursorQuerySchema>

export interface PaginationMeta {
  nextCursor: string | null
  hasMore: boolean
  limit: number
}

/** Декодированное содержимое курсора: значение поля сортировки + id строки-якоря. */
export interface CursorPayload {
  v: unknown
  id: string
}

/** Кодирует курсор в непрозрачную base64url-строку. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')
}

/**
 * Декодирует курсор. Невалидный вход (не base64url, не JSON, не ожидаемая форма) → `null`, НЕ
 * исключение (SRS-API-005) — вызывающий код сам решает вернуть `400 INVALID_CURSOR`.
 */
export function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'))
    return isValidCursorShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Тип-гард формы `{ v, id }`. Тип `v` относительно `sort`-поля конкретного эндпоинта проверяется отдельно, не здесь. */
export function isValidCursorShape(value: unknown): value is CursorPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return 'v' in value && typeof (value as Record<string, unknown>).id === 'string'
}
