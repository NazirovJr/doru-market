/**
 * `DrizzleOrderRepository` (EP-09, DTJ-227) — реализация `OrderRepositoryPort` поверх
 * `orders`/`order_items` (DTJ-220, `apps/api/src/db/schema/orders.ts`).
 *
 * `save()` — upsert (правило 6 волны 5 — не голый `UPDATE`, `reports/EP09-CTO-BRIEF.md` §6.6):
 * `orders` через `ON CONFLICT (id) DO UPDATE` над ПОЛНЫМ набором колонок (проще и safer, чем
 * частичный SET только «мутирующих после создания» полей — заказ создаётся один раз за
 * checkout, повторный `save()` того же объекта либо создаёт (первый вызов), либо переносит
 * ТЕ ЖЕ значения плюс изменившиеся через state-machine методы поля).
 *
 * `order_items` — БЫЛО `ON CONFLICT (id) DO NOTHING` (DTJ-221: «позиции неизменяемы после
 * создания, все поля readonly»). ИЗМЕНЕНО на `DO UPDATE` (DTJ-302/303, EP-12 §A.3/A.4) — это
 * предположение стало неверным: терминал фармацевта мутирует `fulfillmentStatus`/
 * `scannedBatchId`/... и, при замене партии, сам `inventoryBatchId` ПОСЛЕ создания заказа
 * (`OrderItem.markScannedOk`/`substituteBatch`/`markUnavailable`, см. их JSDoc). `DO UPDATE` над
 * ПОЛНЫМ набором колонок безопасен для существующих вызывающих: `checkout`/`cancel` и т.п.
 * никогда не меняют значения ЭТИХ полей между вызовами `save()` — повторная запись ТЕХ ЖЕ
 * значений идемпотентна, разницы с прежним `DO NOTHING` для них нет.
 *
 * `tx` — `OrderUnitOfWorkTx` (`unknown`), резолвится в конкретный Drizzle-клиент через
 * `resolveDrizzleClient` (см. `drizzle-tx.util.ts`) — тот же паттерн, что `auth`
 * (`DrizzleOtpCodesRepository`, волна 5).
 *
 * ТЕНАНТ-ИЗОЛЯЦИЯ (SRS-API-043/046, доработка по замечанию CTO): `findById`/
 * `findByCheckoutAttemptId` фильтруют `AND orders.tenant_id = :tenantId` — чужой тенант ⇒
 * `null` (не отдельная ветка «forbidden»: SRS-API-046 требует именно `404`, чужая строка не
 * подтверждается как существующая).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { orders, orderItems, type OrderRow } from '@/db/schema/orders.js'
// DTJ-301 (EP-12) — `pharmacies`/`users` importés ТОЛЬКО для очереди терминала (JOIN на имя
// фармацевта + резолвинг сети `pharmacy_admin` через `pharmacies.chain_id`), тот же приём, что
// `InventoryFacadeAdapter` импортирует `pharmacy-inventory.js` напрямую (db/schema — вне
// `modules/**`, `no-cross-module-deep-import`/`no-db-schema-in-business-layers` его не касаются,
// см. JSDoc `InventoryFacadeAdapter`).
import { pharmacies } from '@/db/schema/pharmacies.js'
import { users } from '@/db/schema/users.js'
import {
  ORDER_REPOSITORY_PORT,
  type LockedOrderRow,
  type OrderAdminSummaryRow,
  type OrderCancellationAggregate,
  type OrderGmvAggregate,
  type OrderMetricsPeriod,
  type OrdersAnySearchFilter,
  type OrdersAnySearchPage,
  type OrdersAnySearchPagination,
  type OrderQueueQuery,
  type OrderQueueRow,
  type OrderRepositoryPort,
  type OrderSlaAggregate,
  type OrderUnitOfWorkTx,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'
import { toQueueRow } from './order-queue-row.mapper.js'
import { snapshotToOrderInsert, itemSnapshotToInsert, rowToSnapshot } from './order-row.mapper.js'

@Injectable()
export class DrizzleOrderRepository implements OrderRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findById(tenantId: string, orderId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return this.hydrate(client, row)
  }

  async findByCheckoutAttemptId(tenantId: string, checkoutAttemptId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(orders)
      .where(and(eq(orders.checkoutAttemptId, checkoutAttemptId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return this.hydrate(client, row)
  }

  /** DTJ-315 — см. JSDoc порта: без tenant-фильтра, orderId уже глобально уникален. */
  async findByIdAcrossTenants(orderId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client.select().from(orders).where(eq(orders.id, orderId)).limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return this.hydrate(client, row)
  }

  async save(order: Order, tx?: OrderUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const s = order.toSnapshot()
    const values = snapshotToOrderInsert(s)
    await client
      .insert(orders)
      .values(values)
      .onConflictDoUpdate({ target: orders.id, set: values })
    if (s.items.length > 0) {
      const itemValues = s.items.map((item) => itemSnapshotToInsert(item, s.id))
      // `set: { col: sql`excluded.col`}`, НЕ статическое значение из одной позиции (в отличие
      // от однострочного upsert `orders` выше, где `set: values` безопасен ровно потому, что
      // строка одна): `.values(itemValues)` — МНОГОСТРОЧНЫЙ insert (позиций ≥1 на заказ), и
      // Drizzle применил бы ОДНО статическое значение `set` ко ВСЕМ конфликтующим строкам сразу,
      // если бы оно не ссылалось на `excluded` (псевдотаблицу «то, что пытались вставить ЭТОЙ
      // строкой») — только мутирующие после создания колонки (DTJ-302/303), остальные (цена/
      // количество/...) неизменны, их обновление до тех же значений излишне.
      await client
        .insert(orderItems)
        .values(itemValues)
        .onConflictDoUpdate({
          target: orderItems.id,
          set: {
            fulfillmentStatus: sql`excluded.fulfillment_status`,
            scannedBatchId: sql`excluded.scanned_batch_id`,
            scannedAt: sql`excluded.scanned_at`,
            scannedBy: sql`excluded.scanned_by`,
            scanMethod: sql`excluded.scan_method`,
            itemIssueReason: sql`excluded.item_issue_reason`,
            inventoryBatchId: sql`excluded.inventory_batch_id`,
          },
        })
    }
  }

  private async hydrate(client: DrizzleDb, row: OrderRow): Promise<Order> {
    const itemRows = await client.select().from(orderItems).where(eq(orderItems.orderId, row.id))
    return Order.restore(rowToSnapshot(row, itemRows))
  }

  /** DTJ-301 (SRS-PHT-007/009, TC-PHT-023) — см. JSDoc порта: `tx` обязателен, лочит РОВНО строку `orders`. */
  async findByIdForUpdate(tenantId: string, orderId: string, tx: OrderUnitOfWorkTx): Promise<LockedOrderRow | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1)
      .for('update')
    const row = rows[0]
    if (row === undefined) return null
    const order = await this.hydrate(client, row)
    return { order, assignedPharmacistId: row.assignedPharmacistId }
  }

  /** DTJ-301 — см. JSDoc порта. Точечный `UPDATE`, не через `save()` (поле вне `OrderSnapshot`). */
  async setAssignedPharmacist(orderId: string, pharmacistId: string, tx: OrderUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    await client.update(orders).set({ assignedPharmacistId: pharmacistId }).where(eq(orders.id, orderId))
  }

  /** DTJ-301 — см. JSDoc порта. Best-effort: несуществующий пользователь → `null`, не бросает. */
  async findAssignedPharmacistName(pharmacistId: string): Promise<string | null> {
    const rows = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, pharmacistId)).limit(1)
    return rows[0]?.fullName ?? null
  }

  /**
   * DTJ-301 (SRS-PHT-005a) — см. JSDoc порта. `_tenantId` НЕ участвует в фильтре: `pharmacy_
   * chains.tenant_id` — НЕ простая тенант-принадлежность (SRS-TEN-003, `postgres-pharmacy-map.
   * adapter.ts` JSDoc «Скоуп по тенанту») — `NULL` означает «нейтральная/маркетплейсная сеть»,
   * видимая ЛЮБОМУ нейтральному тенанту, а не «ничья»; наивное `= tenantId` без учёта нейтрального
   * случая либо теряло бы легитимные нейтральные сети, либо (при обратной логике) требовало бы
   * JOIN на `tenants.is_neutral`, которого этот метод не имеет повода тянуть — резолвинг `chainId
   * → pharmacyId[]` только СУЖАЕТ кандидатов ДО обращения к `orders`, а РЕАЛЬНУЮ тенант-изоляцию
   * (SRS-API-043/046) уже даёт `findQueueOrders`'s `eq(orders.tenantId, query.tenantId)` —
   * поэтому здесь достаточно `pharmacies.chain_id = :chainId` (сам `chainId` — из JWT актора,
   * подделать нельзя без валидного токена).
   */
  async findPharmacyIdsByChain(_tenantId: string, chainId: string): Promise<readonly string[]> {
    const rows = await this.db.select({ id: pharmacies.id }).from(pharmacies).where(eq(pharmacies.chainId, chainId))
    return rows.map((r) => r.id)
  }

  /**
   * DTJ-301 (SRS-PHT-005/006) — кандидаты очереди, БЕЗ сортировки/пагинации (`OrderQueueSortPolicy`,
   * application). Два запроса: (1) `orders` LEFT JOIN `users` (имя текущего исполнителя), (2)
   * `COUNT(*) GROUP BY order_id` на `order_items` (масштаб MVP — очередь одной аптеки/сети, не
   * весь исторический массив заказов, см. «Риски» тикета).
   */
  async findQueueOrders(query: OrderQueueQuery): Promise<readonly OrderQueueRow[]> {
    const pharmacyIds =
      query.scope.kind === 'pharmacy' ? [query.scope.pharmacyId] : await this.findPharmacyIdsByChain(query.tenantId, query.scope.chainId)
    if (pharmacyIds.length === 0) return []
    const rows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        pharmacyId: orders.pharmacyId,
        itemsTotalTjs: orders.itemsTotalTjs,
        paymentMethod: orders.paymentMethod,
        prescriptionId: orders.prescriptionId,
        slaDeadlineAt: orders.slaDeadlineAt,
        assignedPharmacistId: orders.assignedPharmacistId,
        assignedPharmacistName: users.fullName,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.assignedPharmacistId))
      .where(and(eq(orders.tenantId, query.tenantId), inArray(orders.pharmacyId, pharmacyIds), inArray(orders.status, query.statuses)))
    if (rows.length === 0) return []
    const countByOrder = await this.countItemsByOrder(rows.map((r) => r.id))
    return rows.map((row) => toQueueRow(row, countByOrder.get(row.id) ?? 0))
  }

  /** Вынесено из `findQueueOrders` ради `max-lines-per-function` (C1). */
  private async countItemsByOrder(orderIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const rows = await this.db
      .select({ orderId: orderItems.orderId, cnt: sql<number>`count(*)::int` })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .groupBy(orderItems.orderId)
    return new Map(rows.filter((r): r is { orderId: string; cnt: number } => r.orderId !== null).map((r) => [r.orderId, r.cnt]))
  }

  // GMV — по факту доставки (status='delivered' AND delivered_at ∈ period), не по created_at.
  async getGmvAggregate(tenantId: string, period: OrderMetricsPeriod): Promise<OrderGmvAggregate> {
    const rows = await this.db
      .select({ orderCount: sql<number>`count(*)::int`, gmvTjs: sql<string>`COALESCE(SUM(${orders.totalAmountTjs}), 0)::text` })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.status, 'delivered'),
          gte(orders.deliveredAt, period.start),
          lt(orders.deliveredAt, period.end),
        ),
      )
    const row = rows[0]
    return { gmvDiram: Money.fromDbDecimalTjs(row?.gmvTjs ?? '0').diram, orderCount: row?.orderCount ?? 0 }
  }

  // ASSUMPTION: домен несёт только один SLA-дедлайн (сборка); доставка мерится picked_up_at→delivered_at против deliverySlaMinutes, без зоны город/удалённая.
  async getSlaAggregate(tenantId: string, period: OrderMetricsPeriod, deliverySlaMinutes: number): Promise<OrderSlaAggregate> {
    const deliverySlaInterval = sql.raw(`interval '${String(deliverySlaMinutes)} minutes'`)
    const rows = await this.db
      .select({
        pickupEligibleCount: sql<number>`count(*) FILTER (WHERE ${orders.pickedUpAt} >= ${period.start} AND ${orders.pickedUpAt} < ${period.end})::int`,
        pickupMetCount: sql<number>`count(*) FILTER (WHERE ${orders.pickedUpAt} >= ${period.start} AND ${orders.pickedUpAt} < ${period.end} AND ${orders.pickedUpAt} <= ${orders.slaDeadlineAt})::int`,
        deliveryEligibleCount: sql<number>`count(*) FILTER (WHERE ${orders.deliveredAt} >= ${period.start} AND ${orders.deliveredAt} < ${period.end} AND ${orders.pickedUpAt} IS NOT NULL)::int`,
        deliveryMetCount: sql<number>`count(*) FILTER (WHERE ${orders.deliveredAt} >= ${period.start} AND ${orders.deliveredAt} < ${period.end} AND ${orders.pickedUpAt} IS NOT NULL AND (${orders.deliveredAt} - ${orders.pickedUpAt}) <= ${deliverySlaInterval})::int`,
      })
      .from(orders)
      .where(eq(orders.tenantId, tenantId))
    const row = rows[0]
    return {
      pickupEligibleCount: row?.pickupEligibleCount ?? 0,
      pickupMetCount: row?.pickupMetCount ?? 0,
      deliveryEligibleCount: row?.deliveryEligibleCount ?? 0,
      deliveryMetCount: row?.deliveryMetCount ?? 0,
    }
  }

  async getCancellationAggregate(tenantId: string, period: OrderMetricsPeriod): Promise<OrderCancellationAggregate> {
    const rows = await this.db
      .select({
        totalCount: sql<number>`count(*)::int`,
        cancelledCount: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'cancelled')::int`,
      })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, period.start), lt(orders.createdAt, period.end)))
    const row = rows[0]
    return { totalCount: row?.totalCount ?? 0, cancelledCount: row?.cancelledCount ?? 0 }
  }

  // leftJoin (не innerJoin) — заказы без pharmacyId не должны выпадать из кросс-тенантной выдачи; own-scope фильтруется условием WHERE, не типом джойна.
  async findOrdersAny(filter: OrdersAnySearchFilter, pagination: OrdersAnySearchPagination): Promise<OrdersAnySearchPage> {
    const cursor = pagination.cursor ?? null
    const conditions = buildOrdersAnyConditions(filter, cursor)
    const rows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        tenantId: orders.tenantId,
        pharmacyId: orders.pharmacyId,
        customerId: orders.customerId,
        paymentMethod: orders.paymentMethod,
        totalAmountTjs: orders.totalAmountTjs,
        slaBreached: SLA_BREACHED_EXPR,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(pharmacies, eq(pharmacies.id, orders.pharmacyId))
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(pagination.limit + 1)
    const hasMore = rows.length > pagination.limit
    const page = hasMore ? rows.slice(0, pagination.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toOrderAdminSummaryRow),
      nextCursor: hasMore && last !== undefined ? { v: normalizeCreatedAt(last.createdAt).toISOString(), id: last.id } : null,
      hasMore,
    }
  }
}

// Единственное место, вычисляющее slaBreached — не пересчитывается вызывающим кодом (единый источник истины).
const SLA_BREACHED_EXPR = sql<boolean>`(${orders.status} = 'processing' AND ${orders.slaDeadlineAt} IS NOT NULL AND ${orders.slaDeadlineAt} < NOW())`

function buildOrdersAnyConditions(filter: OrdersAnySearchFilter, cursor: { readonly v: string; readonly id: string } | null): SQL[] {
  const conditions: SQL[] = [...buildOrdersAnyEqualityConditions(filter), ...buildOrdersAnyRangeConditions(filter)]
  const cursorCondition = cursor !== null ? keysetConditionOrdersAny(cursor) : undefined
  if (cursorCondition !== undefined) conditions.push(cursorCondition)
  return conditions
}

function buildOrdersAnyEqualityConditions(filter: OrdersAnySearchFilter): SQL[] {
  const conditions: SQL[] = []
  if (filter.orderNumberLike !== undefined) conditions.push(ilike(orders.orderNumber, `%${filter.orderNumberLike}%`))
  if (filter.status !== undefined) conditions.push(eq(orders.status, filter.status))
  if (filter.tenantId !== undefined) conditions.push(eq(orders.tenantId, filter.tenantId))
  if (filter.pharmacyId !== undefined) conditions.push(eq(orders.pharmacyId, filter.pharmacyId))
  if (filter.chainId !== undefined) conditions.push(eq(pharmacies.chainId, filter.chainId))
  if (filter.customerId !== undefined) conditions.push(eq(orders.customerId, filter.customerId))
  return conditions
}

function buildOrdersAnyRangeConditions(filter: OrdersAnySearchFilter): SQL[] {
  const conditions: SQL[] = []
  if (filter.createdAtFrom !== undefined) conditions.push(gte(orders.createdAt, filter.createdAtFrom))
  if (filter.createdAtTo !== undefined) conditions.push(lt(orders.createdAt, filter.createdAtTo))
  if (filter.slaBreached === true) conditions.push(SLA_BREACHED_EXPR)
  return conditions
}

function keysetConditionOrdersAny(cursor: { readonly v: string; readonly id: string }): SQL | undefined {
  const anchorCreatedAt = new Date(cursor.v)
  return or(lt(orders.createdAt, anchorCreatedAt), and(eq(orders.createdAt, anchorCreatedAt), lt(orders.id, cursor.id)))
}

interface OrderAdminSummarySelectionRow {
  readonly id: string
  readonly orderNumber: string
  readonly status: OrderRow['status']
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly customerId: string
  readonly paymentMethod: string
  readonly totalAmountTjs: string
  readonly slaBreached: boolean
  readonly createdAt: Date | string | null
}

function toOrderAdminSummaryRow(row: OrderAdminSummarySelectionRow): OrderAdminSummaryRow {
  if (row.status === null) {
    throw new Error(`orders.status is NULL for order ${row.id} — data integrity violation`)
  }
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    tenantId: row.tenantId,
    pharmacyId: row.pharmacyId,
    customerId: row.customerId,
    paymentMethod: row.paymentMethod as OrderAdminSummaryRow['paymentMethod'],
    totalAmountDiram: Number(Money.fromDbDecimalTjs(row.totalAmountTjs).diram),
    slaBreached: row.slaBreached,
    createdAt: normalizeCreatedAt(row.createdAt),
  }
}

// created_at приходит от pg то Date, то строкой.
function normalizeCreatedAt(value: Date | string | null): Date {
  return value === null ? new Date(0) : new Date(value)
}

export const ORDER_REPOSITORY_DRIZZLE_PROVIDER = {
  provide: ORDER_REPOSITORY_PORT,
  useClass: DrizzleOrderRepository,
} as const
