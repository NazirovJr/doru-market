/**
 * Единый формат ответа API (`docs/spec/12-api-conventions-auth-tenancy.md` §2, SRS-API-014/015),
 * DTJ-005. Успех — `{ data, meta? }`, ошибка — `{ error: { code, message, details? } }`.
 * `ok`/`fail` — хелперы для единообразной сборки ответа в контроллерах (используются DTJ-018).
 */
import type { ErrorCode } from './errors.js'
import type { PaginationMeta } from './pagination.js'

/** Доп. поля `meta` (например `locale`) объявляются потребителем через индексную сигнатуру. */
export interface EnvelopeMeta {
  pagination?: PaginationMeta
  [key: string]: unknown
}

export interface SuccessEnvelope<T> {
  data: T
  meta?: EnvelopeMeta
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode
    message: string
    details?: Record<string, unknown>
  }
}

/** Собирает успешный ответ `{ data, meta? }`. */
export function ok<T>(data: T, meta?: EnvelopeMeta): SuccessEnvelope<T> {
  return meta === undefined ? { data } : { data, meta }
}

/** Собирает ответ-ошибку `{ error: { code, message, details? } }`. */
export function fail(code: ErrorCode, message: string, details?: Record<string, unknown>): ErrorEnvelope {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } }
}

/** Type-guard для уже сформированного `SuccessEnvelope` (используется `ResponseInterceptor`). */
export function isSuccessEnvelope(value: unknown): value is SuccessEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    !('error' in value)
  )
}
