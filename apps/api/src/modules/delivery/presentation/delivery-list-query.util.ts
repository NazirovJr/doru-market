import { InvalidCursorError, ValidationError, cursorQuerySchema, decodeCursor } from '@dorutj/contracts'

export interface DeliveryListQueryParams {
  readonly limit?: string
  readonly cursor?: string
  // литеральный ключ — Fastify без qs не разворачивает filter[courierId] во вложенный объект
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

export function parseCourierIdFilter(query: DeliveryListQueryParams): string | null {
  const raw = query['filter[courierId]']
  return raw === undefined || raw.trim() === '' ? null : raw
}
