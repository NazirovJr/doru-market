/**
 * `CursorQueryPipe` (EP-01, DTJ-018, SRS-API-004/005/006/007) — NestJS `PipeTransform`,
 * который парсит query-параметры `cursor`/`limit`/`sort`/`filter` через Zod-схему
 * (расширяющую `cursorQuerySchema` из `packages/contracts/pagination`, DTJ-005).
 *
 * Два РАЗНЫХ кода на два разных случая (SRS-API-005, JSDoc-комментарий в тикете):
 *   - `sort`/`filter` вне разрешённого enum'а → `400 VALIDATION_ERROR` (это параметры запроса, не cursor);
 *   - декодированный `cursor` имеет поле `v` неожиданного типа → `400 INVALID_CURSOR` (структурно не
 *     совпадает с тем, что ожидает сортировка эндпоинта).
 *
 * НЕ пытаемся «подогнать» cursor под тип принудительно — падаем явно, детерминированно.
 */
import { BadRequestException, Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common'
import { type ZodError, z } from 'zod'
import { ErrorCode, InvalidCursorError, ValidationError } from '@dorutj/contracts'

/**
 * Контракт для эндпоинтов с cursor-пагинацией: `cursorQuerySchema` из `packages/contracts`
 * расширенный полями `sort` (enum конкретного эндпоинта) и `filter` (record string→unknown).
 */
export interface CursorQuerySchema {
  cursor: { v: unknown } | null
  limit: number
  sort: string
  filter: Record<string, unknown>
}

const baseQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  sort: z.string().min(1).optional().default('created_at'),
  filter: z.record(z.string(), z.unknown()).optional().default({}),
})

/**
 * Параметр `expectedCursorValueType` — литеральный тип, который должен быть
 * у `cursor.v` для текущего эндпоинта (`'number'|'string'|'date'` и т.п.).
 * Используется, чтобы отличить «невалидный cursor» от «валидного для другого эндпоинта».
 */
export type CursorValueType = 'number' | 'string' | 'date'

@Injectable()
export class CursorQueryPipe implements PipeTransform {
  constructor(
    private readonly sortEnum: z.ZodEnum,
    private readonly expectedCursorValueType: CursorValueType = 'date',
  ) {}

  transform(value: Record<string, unknown> | undefined, _metadata: ArgumentMetadata): CursorQuerySchema {
    const parsed = baseQuerySchema.safeParse(value ?? {})
    if (!parsed.success) {
      throw zodErrorToBadRequestException(parsed.error)
    }
    const { cursor: cursorRaw, limit, sort: sortRaw, filter } = parsed.data
    const allowedSorts = this.sortEnum.options.map((opt) => String(opt))
    if (!allowedSorts.includes(sortRaw)) {
      throw new BadRequestException(
        new ValidationError(
          `Invalid sort value: "${sortRaw}"`,
          { field: 'sort', value: sortRaw, allowed: allowedSorts },
          ErrorCode.VALIDATION_ERROR,
        ),
      )
    }
    let cursor: { v: unknown } | null = null
    if (typeof cursorRaw === 'string' && cursorRaw.length > 0) {
      const decoded = decodeCursor(cursorRaw)
      if (decoded === null) {
        throw new BadRequestException(
          new InvalidCursorError(`Cannot decode cursor: "${cursorRaw}"`, { raw: cursorRaw }),
        )
      }
      if (!matchesCursorType(decoded.v, this.expectedCursorValueType)) {
        throw new BadRequestException(
          new InvalidCursorError(
            `Cursor value type mismatch: expected ${this.expectedCursorValueType}, got ${typeof decoded.v}`,
            {
              expected: this.expectedCursorValueType,
              actual: typeof decoded.v,
            },
          ),
        )
      }
      cursor = decoded
    }
    return { cursor, limit, sort: sortRaw, filter }
  }
}

/**
 * Декодирует opaque cursor: base64url(JSON.stringify({ v })). Возвращает `null`
 * при ошибке декодирования (malformed base64 или невалидный JSON).
 */
function decodeCursor(raw: string): { v: unknown } | null {
  try {
    // Buffer — Node-only; в браузере этот код не используется.
    const json = Buffer.from(raw, 'base64url').toString('utf-8')
    const parsed = JSON.parse(json) as unknown
    if (typeof parsed === 'object' && parsed !== null && 'v' in parsed) {
      return { v: (parsed).v }
    }
    return null
  } catch {
    return null
  }
}

function matchesCursorType(value: unknown, expected: CursorValueType): boolean {
  switch (expected) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'string':
      return typeof value === 'string'
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    default:
      return false
  }
}

function zodErrorToBadRequestException(error: ZodError): BadRequestException {
  const firstIssue = error.issues[0]
  return new BadRequestException(
    new ValidationError(
      firstIssue?.message ?? 'Invalid query parameters',
      { issues: error.issues },
      ErrorCode.VALIDATION_ERROR,
    ),
  )
}
