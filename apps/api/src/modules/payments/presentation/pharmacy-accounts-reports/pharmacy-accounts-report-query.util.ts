/**
 * Общий парсинг query-параметров `limit`/`cursor`/`filter[status][in]` ДВУХ контроллеров этого
 * тикета (DTJ-252) — `GetPayoutsController`/`GetBillingInvoicesController`. `cursorQuerySchema`/
 * `decodeCursor` — из `packages/contracts/pagination` (DTJ-005), тикет явно требует переиспользовать
 * готовую курсорную пагинацию, не изобретать свою.
 *
 * `filter[status][in]` — bracket-синтаксис как ЛИТЕРАЛЬНОЕ имя query-параметра (Fastify default
 * querystring НЕ разворачивает `a[b][c]` в вложенный объект), тот же приём, что
 * `PharmacyAccountsAdminController` (`@Query('filter[licenseExpiryDate][lte]')`, DTJ-073) —
 * прямой прецедент в этой же кодовой базе.
 *
 * Ошибки валидации — доменные (`ValidationError`/`InvalidCursorError`), брошены НАПРЯМУЮ, без
 * обёртки в `BadRequestException`: `AllExceptionsFilter` (`@Catch()`) перехватывает `DomainError`
 * из ЛЮБОГО места пайплайна запроса (пайп/гвард/контроллер/сервис) одинаково — обёртка нужна
 * НЕ везде (см. `GetOrderLedgerQuery`, бросающий `ForbiddenError`/`NotFoundError` напрямую).
 */
import { InvalidCursorError, ValidationError, cursorQuerySchema, decodeCursor } from '@dorutj/contracts'

export interface ParsedCursor {
  readonly v: string
  readonly id: string
}

export interface ParsedListQuery {
  readonly limit: number
  readonly cursor: ParsedCursor | null
}

export function parseListQuery(limitRaw: string | undefined, cursorRaw: string | undefined): ParsedListQuery {
  const parsed = cursorQuerySchema.safeParse({ limit: limitRaw, cursor: cursorRaw })
  if (!parsed.success) {
    throw new ValidationError('Invalid limit/cursor query parameters', { issues: parsed.error.issues })
  }
  const { limit, cursor: rawCursor } = parsed.data
  if (rawCursor === undefined) {
    return { limit, cursor: null }
  }
  const decoded = decodeCursor(rawCursor)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${rawCursor}"`, { raw: rawCursor })
  }
  return { limit, cursor: { v: decoded.v, id: decoded.id } }
}

/** `filter[status][in]=due,paid` → `['due', 'paid']`. Пустое/отсутствующее значение → `undefined` (без фильтра). */
export function parseStatusesFilter(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined
  }
  const statuses = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  return statuses.length > 0 ? statuses : undefined
}
