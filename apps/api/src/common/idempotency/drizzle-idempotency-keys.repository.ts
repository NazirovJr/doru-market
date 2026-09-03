/**
 * `DrizzleIdempotencyKeysRepository` (EP-09, DTJ-227, D-EP09-18) — production-адаптер поверх
 * `idempotency_keys` (EP-01, DTJ-017, `db/schema/idempotency-keys.schema.ts`). Заменяет
 * `InMemoryIdempotencyKeysRepository` в `idempotency.module.ts` — первый реальный потребитель
 * `@Idempotent()`, как и предписывал JSDoc того модуля с момента DTJ-019.
 *
 * **Почему это входит в DTJ-227, не в отдельный тикет EP-01:** пока адаптер — in-memory, ключи
 * не переживают рестарт процесса и не видны второму инстансу приложения. Для checkout это
 * означает, что повторный `POST /api/v1/orders` создаёт ВТОРОЙ заказ — списанный остаток,
 * задвоенный платёж, реальные деньги (D-EP09-18, `reports/EP09-CTO-BRIEF.md`). AC5 тикета
 * («повторный запрос возвращает сохранённый ответ») прошёл бы зелёным в однопроцессном тесте,
 * будучи ложным в проде — тот же класс дефекта, что урок волны 4 (§3
 * `docs/07-WAVE4-HANDOFF.md`: зелёные гейты не доказывают работоспособность).
 *
 * **Гонка `createProcessing` (SRS-API-010):** `UNIQUE(user_id, endpoint, key)` на уровне БД —
 * единственная реальная гарантия атомарности; код `23505` (unique_violation Postgres) ловится
 * и транслируется в `IdempotencyKeyConflictError`, а не пропускается как сырое исключение
 * драйвера — контракт порта требует ИМЕННО этот класс ошибки (см. `idempotency-keys.
 * repository.ts` JSDoc).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import type { ErrorEnvelope, SuccessEnvelope } from '@dorutj/contracts'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { idempotencyKeys } from '@/db/schema/idempotency-keys.schema.js'
import {
  IDEMPOTENCY_KEYS,
  IdempotencyKeyConflictError,
  type IdempotencyKeyRecord,
  type IdempotencyKeysRepository,
} from './idempotency-keys.repository.js'

/** Postgres SQLSTATE 23505 — unique_violation. */
const UNIQUE_VIOLATION_SQLSTATE = '23505'

@Injectable()
export class DrizzleIdempotencyKeysRepository implements IdempotencyKeysRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findByTriple(userId: string, endpoint: string, key: string): Promise<IdempotencyKeyRecord | null> {
    const rows = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.endpoint, endpoint),
          eq(idempotencyKeys.key, key),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : rowToRecord(row)
  }

  async createProcessing(input: {
    userId: string
    endpoint: string
    key: string
    requestHash: string
  }): Promise<IdempotencyKeyRecord> {
    try {
      const rows = await this.db
        .insert(idempotencyKeys)
        .values({
          userId: input.userId,
          endpoint: input.endpoint,
          key: input.key,
          requestHash: input.requestHash,
          status: 'processing',
        })
        .returning()
      const row = rows[0]
      if (row === undefined) {
        throw new Error('idempotency_keys insert returned no rows')
      }
      return rowToRecord(row)
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new IdempotencyKeyConflictError({ reason: 'triple already exists' })
      }
      throw error
    }
  }

  async markCompleted(
    id: string,
    responseStatus: number,
    responseBody: ErrorEnvelope | SuccessEnvelope<unknown>,
  ): Promise<void> {
    const rows = await this.db
      .update(idempotencyKeys)
      .set({ status: 'completed', responseStatus, responseBody })
      .where(eq(idempotencyKeys.id, id))
      .returning({ id: idempotencyKeys.id })
    if (rows.length === 0) {
      throw new Error(`idempotency record not found: ${id}`)
    }
  }

  async releaseProcessing(id: string): Promise<void> {
    const rows = await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id)).returning({ id: idempotencyKeys.id })
    if (rows.length === 0) {
      throw new Error(`idempotency record not found: ${id}`)
    }
  }
}

function rowToRecord(row: typeof idempotencyKeys.$inferSelect): IdempotencyKeyRecord {
  return {
    id: row.id,
    userId: row.userId,
    endpoint: row.endpoint,
    key: row.key,
    requestHash: row.requestHash,
    status: row.status,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody as IdempotencyKeyRecord['responseBody'],
    createdAt: row.createdAt,
  }
}

/**
 * `node-postgres` кладёт SQLSTATE в `.code` на СЫРОЙ ошибке драйвера, но Drizzle
 * (`drizzle-orm/node-postgres`) оборачивает её в собственный `DrizzleQueryError` с
 * `.cause = <сырая ошибка pg>` (`.code` самого `DrizzleQueryError` — `undefined`, проверено
 * прогоном против живого Postgres, foundIssue: JSDoc `drizzle-tx.util.ts`-соседей об этом не
 * предупреждает). Проверяем ОБА уровня — прямой `.code` (на случай будущей смены обёртки
 * Drizzle) и `.cause.code` (текущее фактическое поведение).
 */
function isUniqueViolation(error: unknown): boolean {
  return sqlState(error) === UNIQUE_VIOLATION_SQLSTATE || sqlState(getCause(error)) === UNIQUE_VIOLATION_SQLSTATE
}

function sqlState(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return (error as { code?: unknown }).code
}

function getCause(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return undefined
  return (error as { cause?: unknown }).cause
}

export const IDEMPOTENCY_KEYS_DRIZZLE_PROVIDER = {
  provide: IDEMPOTENCY_KEYS,
  useClass: DrizzleIdempotencyKeysRepository,
} as const
