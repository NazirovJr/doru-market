/**
 * Общий парсинг query-параметров `limit`/`cursor`/`filter[courierId]` ДВУХ контроллеров этого
 * тикета (DTJ-321) — `CourierEarningsController`/`CourierPayoutsController`. 1:1 приём
 * `payments/presentation/pharmacy-accounts-reports/pharmacy-accounts-report-query.util.ts`
 * (DTJ-252) — заведён ЗАНОВО в `delivery`, не импортирован оттуда: межмодульный deep-import
 * чужого `presentation/**` запрещён (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2), тот же приём, что
 * `drizzle-tx.util.ts` (DTJ-314) — маленький файл-дубликат вместо запрещённой межмодульной ссылки.
 *
 * `cursorQuerySchema`/`decodeCursor` — из `packages/contracts` (DTJ-005), переиспользуются, не
 * изобретаются заново.
 *
 * `DeliveryListQueryParams` — ОДИН `@Query()`-параметр без ключа (не три отдельных
 * `@Query('limit')`/`@Query('cursor')`/`@Query('filter[courierId]')`) — `max-params` (C5, ≤3):
 * контроллер уже несёт `@CurrentUser() claims`, три ОТДЕЛЬНЫХ query-параметра дали бы 4 параметра
 * метода. Fastify без `qs` возвращает `?filter[courierId]=x` буквальным плоским ключом
 * `'filter[courierId]'` (не вложенным объектом) — 1:1 приём `PharmacyTerminalQueueController`
 * (см. её JSDoc про `filter[pharmacyId]`).
 */
import { InvalidCursorError, ValidationError, cursorQuerySchema, decodeCursor } from '@dorutj/contracts'

export interface DeliveryListQueryParams {
  readonly limit?: string
  readonly cursor?: string
  readonly 'filter[courierId]'?: string
}

export interface ParsedCursor {
  readonly v: string
  readonly id: string
}

export interface ParsedListQuery {
  readonly limit: number
  readonly cursor: ParsedCursor | null
}

export function parseDeliveryListQuery(query: DeliveryListQueryParams): ParsedListQuery {
  const parsed = cursorQuerySchema.safeParse({ limit: query.limit, cursor: query.cursor })
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

/** `filter[courierId]=` (пусто/отсутствует) -> `null` (без фильтра). */
export function parseCourierIdFilter(query: DeliveryListQueryParams): string | null {
  const raw = query['filter[courierId]']
  return raw === undefined || raw.trim() === '' ? null : raw
}
