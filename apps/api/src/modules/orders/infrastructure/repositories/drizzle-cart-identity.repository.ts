/**
 * `DrizzleCartIdentityRepository` (EP-09, DTJ-226) — реализация `CartIdentityRepository`
 * поверх `cart` (DTJ-220, `apps/api/src/db/schema/cart.ts`). Отдельный файл/класс от
 * `DrizzleCartRepository` (DTJ-223) — см. JSDoc порта, `cart-identity.repository.port.ts`,
 * для обоснования (interface segregation + нулевой риск пересечения файлов с параллельным
 * DTJ-227 в этой же волне).
 *
 * **D-EP09-22 — идемпотентное `findOrCreate*` без миграции схемы.** `cart` не несёт
 * `UNIQUE(tenant_id, customer_id)`/`UNIQUE(tenant_id, session_token)` (DDL DTJ-220,
 * `0023_orders_cart.sql`, вне `files_owned` этого тикета — трогать её не входит в задачу).
 * Без уникального индекса `INSERT ... SELECT ... WHERE NOT EXISTS` НЕ атомарен под
 * `READ COMMITTED` (дефолт Postgres): два конкурентных вызова оба видят «не существует» ДО
 * commit друг друга и оба вставляют — классическая гонка check-then-insert.
 *
 * Решение — `pg_advisory_xact_lock(hashtext(key)::bigint)` внутри `db.transaction(...)`:
 * блокировка транзакционная (снимается САМА на commit/rollback), ключ — детерминированная
 * строка `cart:customer:<tenantId>:<customerId>` / `cart:session:<tenantId>:<sessionToken>`.
 * Первый вызов держит лок до своего commit; второй с ТЕМ ЖЕ ключом блокируется на получении
 * лока, а не на записи — получает лок только ПОСЛЕ commit первого, видит уже вставленную
 * строку и ничего не вставляет повторно. `hashtext` (не `hashtextextended`) — доступен без
 * расширений в любой версии Postgres, `::bigint`-каст под сигнатуру `pg_advisory_xact_lock`.
 *
 * Лок и последующий SELECT/INSERT — РАЗДЕЛЬНЫЕ операторы одной транзакции, не единый `WITH`
 * (CTE без ссылки из основного запроса не гарантированно исполняется планировщиком — PG12+
 * инлайнит/пропускает недостижимые CTE; сторонний эффект `pg_advisory_xact_lock` обязан быть
 * исполнен, поэтому отдельный `tx.execute()`).
 *
 * `@Inject(DRIZZLE_DB)` явный — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import {
  CART_IDENTITY_REPOSITORY,
  type CartIdentityRepository,
} from '@/modules/orders/application/cart/ports/cart-identity.repository.port.js'
import type { CartRecord } from '@/modules/orders/application/cart/ports/cart.repository.port.js'

/** Форма строки `cart` после raw-SQL с ручным camelCase-алиасингом (см. JSDoc `DrizzleCartRepository`). */
interface CartRawRow {
  readonly id: string
  readonly tenantId: string
  readonly customerId: string | null
  readonly sessionToken: string | null
}

const CART_RETURNING_COLUMNS = sql`id, tenant_id AS "tenantId", customer_id AS "customerId", session_token AS "sessionToken"`

@Injectable()
export class DrizzleCartIdentityRepository implements CartIdentityRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findByCustomerId(tenantId: string, customerId: string): Promise<CartRecord | null> {
    const result = await this.db.execute(sql`
      SELECT ${CART_RETURNING_COLUMNS} FROM cart
       WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
       LIMIT 1
    `)
    return firstCartRecord(result)
  }

  async findBySessionToken(tenantId: string, sessionToken: string): Promise<CartRecord | null> {
    const result = await this.db.execute(sql`
      SELECT ${CART_RETURNING_COLUMNS} FROM cart
       WHERE tenant_id = ${tenantId} AND session_token = ${sessionToken}
       LIMIT 1
    `)
    return firstCartRecord(result)
  }

  async findOrCreateByCustomerId(tenantId: string, customerId: string): Promise<CartRecord> {
    return this.findOrCreate(
      `cart:customer:${tenantId}:${customerId}`,
      sql`tenant_id = ${tenantId} AND customer_id = ${customerId}`,
      sql`INSERT INTO cart (tenant_id, customer_id) VALUES (${tenantId}, ${customerId}) RETURNING ${CART_RETURNING_COLUMNS}`,
    )
  }

  async findOrCreateBySessionToken(tenantId: string, sessionToken: string): Promise<CartRecord> {
    return this.findOrCreate(
      `cart:session:${tenantId}:${sessionToken}`,
      sql`tenant_id = ${tenantId} AND session_token = ${sessionToken}`,
      sql`INSERT INTO cart (tenant_id, session_token) VALUES (${tenantId}, ${sessionToken}) RETURNING ${CART_RETURNING_COLUMNS}`,
    )
  }

  async rebindToCustomer(tenantId: string, cartId: string, customerId: string): Promise<CartRecord | null> {
    const result = await this.db.execute(sql`
      UPDATE cart
         SET customer_id = ${customerId}, session_token = NULL, updated_at = NOW()
       WHERE id = ${cartId} AND tenant_id = ${tenantId}
       RETURNING ${CART_RETURNING_COLUMNS}
    `)
    return firstCartRecord(result)
  }

  async deleteCart(tenantId: string, cartId: string): Promise<boolean> {
    const result = await this.db.execute(sql`DELETE FROM cart WHERE id = ${cartId} AND tenant_id = ${tenantId}`)
    return readRowCount(result) > 0
  }

  /** D-EP09-22 — см. JSDoc файла. `lockKey` включает `tenantId`, чтобы одинаковые
   *  `customerId`/`sessionToken` в РАЗНЫХ тенантах (в принципе невозможно для customerId,
   *  теоретически возможно для случайного совпадения session token) не делили один лок. */
  private async findOrCreate(lockKey: string, whereFragment: SQL, insertFragment: SQL): Promise<CartRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`)
      const existing = await tx.execute(sql`SELECT ${CART_RETURNING_COLUMNS} FROM cart WHERE ${whereFragment} LIMIT 1`)
      const existingRecord = firstCartRecord(existing)
      if (existingRecord !== null) {
        return existingRecord
      }
      const inserted = await tx.execute(insertFragment)
      const insertedRecord = firstCartRecord(inserted)
      if (insertedRecord === null) {
        throw new Error('DrizzleCartIdentityRepository.findOrCreate: insert returned no row')
      }
      return insertedRecord
    })
  }
}

function firstCartRecord(result: unknown): CartRecord | null {
  const row = extractCartRows(result)[0]
  if (row === undefined) {
    return null
  }
  return { id: row.id, tenantId: row.tenantId, customerId: row.customerId, sessionToken: row.sessionToken }
}

/** Нормализация результата `db.execute` — тот же приём, что `DrizzleCartRepository.extractCartItemRows`. */
function extractCartRows(result: unknown): readonly CartRawRow[] {
  if (Array.isArray(result)) {
    return result as CartRawRow[]
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows as CartRawRow[]
    }
  }
  return []
}

function readRowCount(result: unknown): number {
  if (result !== null && typeof result === 'object' && 'rowCount' in result) {
    const count = (result as Record<string, unknown>).rowCount
    if (typeof count === 'number') {
      return count
    }
  }
  return 0
}

export const CART_IDENTITY_REPOSITORY_DRIZZLE_PROVIDER = {
  provide: CART_IDENTITY_REPOSITORY,
  useClass: DrizzleCartIdentityRepository,
} as const
