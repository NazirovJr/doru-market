/**
 * `IdempotencyKeysRepository` (EP-01, DTJ-019, SRS-API-010) — порт
 * хранения ключей идемпотентности.
 *
 * **Механизм гонки (SRS-API-010):** `createProcessing()` ОБЯЗАН бросить
 * `IdempotencyKeyConflictError` (не `UNIQUE`-исключение БД) при конфликте
 * `(userId, endpoint, key)`. На уровне БД (`idempotency_keys`) уникальный
 * индекс обеспечивает атомарность (`INSERT ... ON CONFLICT DO NOTHING`
 * или прямая попытка `INSERT` с обработкой `23505`).
 *
 * `markCompleted()` — обновление `status='completed'`, `responseStatus`,
 * `responseBody` после успешного ответа use case'а. Хранилище обязано
 * сохранить `responseBody` для возврата при повторном запросе.
 *
 * `releaseProcessing()` — снимает запись `status='processing'`, когда
 * обработчик бросил ошибку. Без этого одна транзиентная ошибка навсегда
 * отравляет ключ: `status='processing'` осталась бы висеть бессрочно, и
 * КАЖДЫЙ повтор с тем же `Idempotency-Key` получал бы
 * `409 still_processing`, хотя неуспешный запрос не оставил клиенту
 * никакого наблюдаемого результата, который стоило бы кэшировать.
 */
import { type Result } from '@dorutj/domain-kernel'
import { type ErrorCode, type ErrorEnvelope } from '@dorutj/contracts'

export interface IdempotencyKeyRecord {
  id: string
  userId: string
  endpoint: string
  key: string
  requestHash: string
  status: 'processing' | 'completed'
  responseStatus: number | null
  responseBody: ErrorEnvelope | { data: unknown; meta?: unknown } | null
  createdAt: Date
}

export class IdempotencyKeyConflictError extends Error {
  readonly code: ErrorCode = 'IDEMPOTENCY_KEY_CONFLICT' as ErrorCode
  constructor(readonly details: { reason: string }) {
    super(`Idempotency key conflict: ${details.reason}`)
    this.name = 'IdempotencyKeyConflictError'
  }
}

export const IDEMPOTENCY_KEYS = Symbol.for('@dorutj/common/idempotency-keys-repository')

export interface IdempotencyKeysRepository {
  findByTriple(userId: string, endpoint: string, key: string): Promise<IdempotencyKeyRecord | null>
  /**
   * Создаёт `status='processing'` запись. Конфликт `UNIQUE(user_id, endpoint, key)`
   * (другой запрос уже вставил раньше) → `IdempotencyKeyConflictError`.
   */
  createProcessing(input: {
    userId: string
    endpoint: string
    key: string
    requestHash: string
  }): Promise<IdempotencyKeyRecord>
  /** Обновляет запись на `status='completed'`, сохраняет response для повторных вызовов. */
  markCompleted(
    id: string,
    responseStatus: number,
    responseBody: ErrorEnvelope | { data: unknown; meta?: unknown },
  ): Promise<void>
  /**
   * Снимает запись `status='processing'` после ошибки обработчика, освобождая
   * `(userId, endpoint, key)` для повторной попытки. Ответ не кэшируется —
   * запись просто перестаёт существовать, как будто запроса не было.
   */
  releaseProcessing(id: string): Promise<void>
}

/** Type-guard для repository result — не используется, документирует API. */
export type IdempotencyFindResult = Result<IdempotencyKeyRecord | null, never>
