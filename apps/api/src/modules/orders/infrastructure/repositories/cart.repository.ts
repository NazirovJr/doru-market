/**
 * `DrizzleCartRepository` (EP-09, DTJ-223) — реализация `CartRepository` поверх `cart`/
 * `cart_items` (DTJ-220, `apps/api/src/db/schema/cart.ts`).
 *
 * ТЕНАНТ-ИЗОЛЯЦИЯ (SRS-API-043/046, доработка по замечанию CTO — обязательное правило
 * проекта, не опция этого тикета). `cart` несёт `tenant_id` напрямую — `findById` фильтрует
 * типизированным `and(eq(cart.id,...), eq(cart.tenantId,...))`, как остальные Drizzle-
 * репозитории волны 5 (`drizzle-users.repository.ts`, `drizzle-otp-codes.repository.ts`).
 *
 * `cart_items` СВОЕЙ колонки `tenant_id` не несёт (DDL DTJ-220) — скоуп только через
 * `cart_id`, принадлежащий тенантной `cart`. Типизированный `.update()`/`.delete()` Drizzle
 * 0.45 не даёт `USING`/`.from()` на DELETE (`PgDeleteBase` — только `.where()`/`.returning()`,
 * проверено по `node_modules/drizzle-orm/pg-core/query-builders/delete.d.ts`), а «сначала
 * SELECT-проверка владения, потом отдельный UPDATE/DELETE» — ДВА round-trip'а вне транзакции,
 * ровно то TOCTOU-окно, которое CTO запретил явно. Поэтому `findItemsByCartId`/`upsertItem`/
 * `updateItemQuantity`/`deleteItem` — раскрытый `db.execute(sql...)` с `EXISTS (SELECT 1
 * FROM cart WHERE id=:cartId AND tenant_id=:tenantId)` (для upsert — `INSERT ... SELECT` из
 * того же тенант-отфильтрованного подзапроса) ПРЯМО В теле оператора — один атомарный SQL,
 * ноль окна между проверкой и записью. Тот же приём фолбэка на сырой SQL, что
 * `drizzle-pharmacy-inventory.repository.ts` (там — expression-таргет `ON CONFLICT`, здесь —
 * кросс-табличный тенант-фильтр, которого типизированный билдер тоже не выражает).
 *
 * `upsertItem` — `INSERT ... SELECT ... ON CONFLICT DO UPDATE SET quantity =
 * cart_items.quantity + excluded.quantity` — СЛОЖЕНИЕ, не замена (урок волны 5 §6.6
 * `reports/EP09-CTO-BRIEF.md`: голый `UPDATE` на первой вставке матчит 0 строк и молча
 * теряет данные при заявленном успехе). Чужой `tenantId` ⇒ подзапрос по `cart` даёт 0 строк ⇒
 * `INSERT ... SELECT` вставляет 0 строк ⇒ `RETURNING` пуст ⇒ `null` (SRS-API-046: `404`, не
 * `403`, чужой тенант не подтверждает существование корзины).
 *
 * Столбцы raw-SQL алиасятся в camelCase (`cart_id AS "cartId"`) вручную — `db.execute(sql...)`
 * НЕ проходит через schema-aware camelCase-маппинг Drizzle (тот есть только у типизированного
 * `.select()`), `drizzle.provider.ts` не задаёт глобальный `casing`.
 *
 * `extractCartItemRows`/`extractRowCount` — НЕ generic (в отличие от первой версии этого
 * файла): `@typescript-eslint/no-unnecessary-type-parameters` ловит generic, чей параметр
 * типа не выводится ни из одного аргумента функции (только из явно указанного вызывающим) —
 * тот же приём нормализации `db.execute`, что `postgres-pharmacy-map.adapter.ts`/
 * `analog-candidates.adapter.ts` (`extractRows` там тоже НЕ generic, конкретный `PinRow`).
 *
 * `updateItemQuantity` принимает объект-параметр (`UpdateCartItemQuantityRepoInput`), не 4
 * позиционных — `tenantId`+`cartId`+`cartItemId`+`quantity` превышают C5 (`max-params` ≤3).
 *
 * `@Inject(DRIZZLE_DB)` явный — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
 *
 * `cart.updated_at` (D-EP09-13, `reports/EP09-CTO-BRIEF.md`, БЛОКЕР, снятый CTO ДО старта работ
 * DTJ-224): до этой правки НИ ОДИН метод не трогал родительскую `cart` — колонка была
 * фактически временем СОЗДАНИЯ корзины, никогда не обновлялась. Джоба очистки DTJ-224
 * (`CartAbandonedCleanupJob`, `DELETE FROM cart WHERE updated_at < NOW() - INTERVAL
 * 'CART_ABANDONED_TTL_DAYS days'`) удалила бы активную корзину, купленную вчера, но созданную
 * 31 день назад — тихая потеря пользовательских данных. Все ТРИ мутирующих метода
 * (`upsertItem`/`updateItemQuantity`/`deleteItem`) теперь бампают `cart.updated_at = NOW()` ОДНИМ
 * атомарным SQL-оператором вместе с правкой `cart_items` — через `WITH touched_cart AS (UPDATE
 * cart SET updated_at = NOW() WHERE id = :cartId AND tenant_id = :tenantId RETURNING id)`, а
 * основной оператор (`INSERT ... SELECT`/`UPDATE ... EXISTS`/`DELETE ... EXISTS`) читает
 * `touched_cart` ВМЕСТО прежнего инлайн-подзапроса по `cart` — тот же тенант-фильтр, ноль
 * дополнительных round-trip'ов, ноль окна между бампом и мутацией `cart_items` (Postgres
 * гарантирует: data-modifying CTE в `WITH` выполняется РОВНО ОДИН раз в рамках того же
 * оператора). Чужой `tenantId`/несуществующий `cartId` ⇒ `touched_cart` возвращает 0 строк ⇒
 * `cart.updated_at` НЕ трогается (тот же тенант-инвариант, что раньше).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { cart, cartItems, type CartRow } from '@/db/schema/cart.js'
import {
  CART_REPOSITORY,
  type CartItemRecord,
  type CartRecord,
  type CartRepository,
  type UpdateCartItemQuantityRepoInput,
  type UpsertCartItemInput,
} from '@/modules/orders/application/cart/ports/cart.repository.port.js'

/** Форма строки `cart_items` после raw-SQL с ручным camelCase-алиасингом (см. JSDoc файла). */
interface CartItemRawRow {
  readonly id: string
  readonly cartId: string
  readonly medicineId: string
  readonly pharmacyId: string
  readonly quantity: number
  readonly addedAt: Date | string
}

/** Именно эти алиасы переиспользуются в каждом raw-запросе `cart_items` ниже — единый список полей. */
const CART_ITEM_RETURNING_COLUMNS = sql`id, cart_id AS "cartId", medicine_id AS "medicineId", pharmacy_id AS "pharmacyId", quantity, added_at AS "addedAt"`

@Injectable()
export class DrizzleCartRepository implements CartRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findById(tenantId: string, cartId: string): Promise<CartRecord | null> {
    const rows = await this.db
      .select()
      .from(cart)
      .where(and(eq(cart.id, cartId), eq(cart.tenantId, tenantId)))
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : rowToCartRecord(row)
  }

  async findItemsByCartId(tenantId: string, cartId: string): Promise<readonly CartItemRecord[]> {
    const result = await this.db.execute(sql`
      SELECT ${CART_ITEM_RETURNING_COLUMNS}
        FROM cart_items
       WHERE cart_id = ${cartId}
         AND EXISTS (SELECT 1 FROM cart WHERE id = ${cartId} AND tenant_id = ${tenantId})
    `)
    return extractCartItemRows(result).map(rowToCartItemRecord)
  }

  /**
   * DTJ-227 — батч по id, тенант-скоуп через `EXISTS` на родительской `cart` (тот же приём,
   * что `findItemsByCartId`). Типизированный `.select()` использован намеренно (не raw SQL,
   * как остальные методы файла) — здесь нет мутации и нет кросс-табличного тенант-фильтра
   * ВНУТРИ пишущего оператора, обычный `innerJoin` выражает это без сырого SQL.
   */
  async findItemsByIds(tenantId: string, cartItemIds: readonly string[]): Promise<readonly CartItemRecord[]> {
    if (cartItemIds.length === 0) {
      return []
    }
    const rows = await this.db
      .select({
        id: cartItems.id,
        cartId: cartItems.cartId,
        medicineId: cartItems.medicineId,
        pharmacyId: cartItems.pharmacyId,
        quantity: cartItems.quantity,
        addedAt: cartItems.addedAt,
      })
      .from(cartItems)
      .innerJoin(cart, eq(cart.id, cartItems.cartId))
      .where(and(inArray(cartItems.id, [...cartItemIds]), eq(cart.tenantId, tenantId)))
    return rows.map((row) => ({ ...row, addedAt: row.addedAt === null ? new Date() : toDate(row.addedAt) }))
  }

  async upsertItem(tenantId: string, input: UpsertCartItemInput): Promise<CartItemRecord | null> {
    const result = await this.db.execute(sql`
      WITH touched_cart AS (
        UPDATE cart SET updated_at = NOW() WHERE id = ${input.cartId} AND tenant_id = ${tenantId} RETURNING id
      )
      INSERT INTO cart_items (cart_id, medicine_id, pharmacy_id, quantity)
      SELECT id, ${input.medicineId}, ${input.pharmacyId}, ${input.quantityDelta}
        FROM touched_cart
      ON CONFLICT (cart_id, medicine_id, pharmacy_id)
      DO UPDATE SET quantity = cart_items.quantity + excluded.quantity
      RETURNING ${CART_ITEM_RETURNING_COLUMNS}
    `)
    const rows = extractCartItemRows(result)
    return rows[0] === undefined ? null : rowToCartItemRecord(rows[0])
  }

  async updateItemQuantity(input: UpdateCartItemQuantityRepoInput): Promise<CartItemRecord | null> {
    const result = await this.db.execute(sql`
      WITH touched_cart AS (
        UPDATE cart SET updated_at = NOW() WHERE id = ${input.cartId} AND tenant_id = ${input.tenantId} RETURNING id
      )
      UPDATE cart_items
         SET quantity = ${input.quantity}
       WHERE id = ${input.cartItemId}
         AND cart_id = ${input.cartId}
         AND EXISTS (SELECT 1 FROM touched_cart)
      RETURNING ${CART_ITEM_RETURNING_COLUMNS}
    `)
    const rows = extractCartItemRows(result)
    return rows[0] === undefined ? null : rowToCartItemRecord(rows[0])
  }

  async deleteItem(tenantId: string, cartId: string, cartItemId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      WITH touched_cart AS (
        UPDATE cart SET updated_at = NOW() WHERE id = ${cartId} AND tenant_id = ${tenantId} RETURNING id
      )
      DELETE FROM cart_items
       WHERE id = ${cartItemId}
         AND cart_id = ${cartId}
         AND EXISTS (SELECT 1 FROM touched_cart)
    `)
    return extractRowCount(result) > 0
  }
}

function rowToCartRecord(row: CartRow): CartRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    sessionToken: row.sessionToken,
  }
}

function rowToCartItemRecord(row: CartItemRawRow): CartItemRecord {
  return {
    id: row.id,
    cartId: row.cartId,
    medicineId: row.medicineId,
    pharmacyId: row.pharmacyId,
    quantity: row.quantity,
    addedAt: toDate(row.addedAt),
  }
}

function toDate(value: Date | string): Date {
  // node-postgres парсит `timestamptz` в `Date` автоматически, но страхуемся от строки —
  // тот же приём, что `DrizzleOtpCodesRepository.toDate`.
  return value instanceof Date ? value : new Date(value)
}

/**
 * Нормализация результата `db.execute` (совпадает с `postgres-pharmacy-map.adapter.ts`/
 * `analog-candidates.adapter.ts`): `node-postgres`-драйвер Drizzle возвращает объект с
 * `.rows`, но защищаемся и от прямого массива (портируемость/тестовые моки).
 */
function extractCartItemRows(result: unknown): readonly CartItemRawRow[] {
  if (Array.isArray(result)) {
    return result as CartItemRawRow[]
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows as CartItemRawRow[]
    }
  }
  return []
}

/** `deleteItem` не нуждается в форме строки — только в количестве затронутых (`rowCount` pg). */
function extractRowCount(result: unknown): number {
  if (result !== null && typeof result === 'object' && 'rowCount' in result) {
    const count = (result as Record<string, unknown>).rowCount
    if (typeof count === 'number') {
      return count
    }
  }
  return 0
}

export const CART_REPOSITORY_DRIZZLE_PROVIDER = {
  provide: CART_REPOSITORY,
  useClass: DrizzleCartRepository,
} as const
