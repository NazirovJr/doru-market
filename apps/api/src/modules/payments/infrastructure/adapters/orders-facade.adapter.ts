/**
 * `OrdersFacadeAdapter` (EP-10, DTJ-242, `files_owned`) — КАНОНИЧЕСКАЯ реализация
 * `PaymentsOrdersPort` (`application/ports/orders-facade.port.ts`, DTJ-236) поверх реального
 * `modules/orders` → `OrdersFacade` (`application/orders.facade.ts`, EP-09, DTJ-222/227).
 * Заменяет временный `OrdersReadOnlyAdapter` (DTJ-248, `getOrderById`-only обход того же
 * DI-цикла) в биндинге `PAYMENTS_ORDERS_PORT` — см. явный комментарий-приглашение там же и в
 * `payments.module.ts`.
 *
 * DI-ЦИКЛ (то же препятствие, что `RetryPaymentUseCase`/`OrdersReadOnlyAdapter` уже
 * документировали, `no-circular` `dependency-cruiser`): `orders.module.ts` уже импортирует
 * `PaymentsModule` (DTJ-227/241, `PAYMENT_INVOICE_PORT`). Буквальный `imports: [OrdersModule]`
 * в `payments.module.ts` замкнул бы `orders.module.ts → payments.module.ts → orders.module.ts`
 * — СТАТИЧЕСКИЙ ES-импорт-цикл, `forwardRef()` его не убирает (только DI-резолвинг Nest, не
 * граф импортов, который проверяет depcruise). Решение — `@Global()` на `OrdersModule`
 * (`orders.module.ts`, абзац «РЕШЕНО (DTJ-242)» там же): `ORDERS_FACADE`/`OrdersFacade`
 * становятся видны `payments.module.ts` БЕЗ единого нового `import` файла `orders.module.ts` —
 * ЭТОТ файл импортирует ТОЛЬКО `@/modules/orders/index.js` (публичный фасад, `02` §1.2), не
 * `orders.module.ts`; цикл физически невозможен (см. отчёт сдачи, DISPUTED — CTO не был
 * доступен интерактивно в рамках этого прогона, решение принято и явно задокументировано, а
 * не обойдено молча).
 *
 * `getOrderById(tenantId, orderId, tx?)` — ДВЕ ветки:
 *   - `tx` ОТСУТСТВУЕТ: тонкая делегация `OrdersFacade.getOrderById()` (read-only диагностика,
 *     `GetOrderLedgerQuery` DTJ-248 и т.п.) — без блокировки строки.
 *   - `tx` ПЕРЕДАН: `SELECT ... FOR UPDATE` НАПРЯМУЮ через Drizzle (SRS-DOM-165, построчная
 *     блокировка) — `OrdersFacade`/`DrizzleOrderRepository` (DTJ-227) сами по себе `FOR UPDATE`
 *     не делают (обычный `SELECT`), а буквальный текст DTJ-242 требует именно её ПЕРЕД
 *     `markPaidEscrow` внутри транзакции вебхука. Раздельный запрос вместо правки
 *     `orders/infrastructure/repositories/order.repository.ts` (чужой файл, `orders/checkout`
 *     — периметр другого исполнителя, правило задания «не лезь») — тот же приём, что
 *     `DrizzleEscrowLedgerRepository.orderBelongsToTenant` (DTJ-240): чтение ЧУЖОЙ
 *     Drizzle-схемы (не `domain`/`application`) из СВОЕГО `infrastructure` — не межмодульный
 *     deep-import (`02` §1.1 запрещает импорт `domain`/`application` чужого модуля, не
 *     импорт таблицы). Лок держится до `COMMIT/ROLLBACK` транзакции вебхука — `markPaidEscrow`
 *     (ниже), вызванный С ТЕМ ЖЕ `tx`, видит УЖЕ заблокированную строку, повторный `SELECT`
 *     внутри `OrdersFacade` не создаёт второй лок (тот же Postgres-снапшот транзакции).
 *
 * `markPaidEscrow`/`cancel` — тонкая делегация `OrdersFacade` с маппингом
 * payments-примитивов → orders-типы (branded `OrderCancelReason`/`OrderCancelActor`) БЕЗ
 * импорта `orders/domain/*` по имени — TypeScript выводит форму структурно через
 * ПУБЛИЧНЫЙ тип `OrdersFacade` (`export type { OrdersFacade }`, `orders/index.ts`), деталь
 * реализации `Order`/`OrderCancelReason` остаётся приватной для payments (тот же приём, что
 * `PaymentInvoicePort`/`orders`-сторона).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { orders } from '@/db/schema/orders.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { ORDERS_FACADE, type OrdersFacade, type OrderCancelReason } from '@/modules/orders/index.js'
import {
  type PaymentsOrderActor,
  type PaymentsOrderSnapshot,
  type PaymentsOrdersPort,
  type PaymentsUnitOfWorkTx,
} from '@/modules/payments/application/ports/orders-facade.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

/**
 * SRS-ORD-030 — значения ДУБЛИРУЮТСЯ здесь как runtime-массив (payments НЕ импортирует
 * `orders/domain/order-domain-event.js` — деталь реализации, не публичный фасад), но
 * `satisfies readonly OrderCancelReason[]` привязывает их к КАНОНИЧЕСКОМУ типу, теперь
 * ре-экспортированному `orders/index.ts` (`02` §1.2) — расхождение (лишнее/переименованное
 * значение) ловится `tsc` на этом файле, не только рассуждением «то же самое».
 */
const KNOWN_CANCEL_REASONS = [
  'customer_changed_mind',
  'found_cheaper_elsewhere',
  'pharmacy_suspended',
  'payment_timeout',
  'pickup_sla_timeout',
  'fraud_or_safety_force_cancel',
  'license_revoked_force_cancel',
  'late_payment_after_cancellation',
] as const satisfies readonly OrderCancelReason[]

function isKnownCancelReason(value: string): value is OrderCancelReason {
  return (KNOWN_CANCEL_REASONS as readonly string[]).includes(value)
}

interface OrderLockRow {
  readonly id: string
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly status: string | null
  readonly paymentMethod: string
  readonly totalAmountTjs: string
}

@Injectable()
export class OrdersFacadeAdapter implements PaymentsOrdersPort {
  public constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(ORDERS_FACADE) private readonly ordersFacade: OrdersFacade,
  ) {}

  public async getOrderById(tenantId: string, orderId: string, tx?: PaymentsUnitOfWorkTx): Promise<PaymentsOrderSnapshot | null> {
    if (tx !== undefined) {
      return this.getOrderByIdLocking(tenantId, orderId, tx)
    }
    const order = await this.ordersFacade.getOrderById(tenantId, orderId)
    if (order === null) return null
    const pharmacyChainId = await this.resolvePharmacyChainId(order.pharmacyId, this.db)
    return {
      id: order.id,
      tenantId: order.tenantId,
      pharmacyId: order.pharmacyId,
      status: order.status,
      paymentMethod: order.paymentMethod,
      totalAmountDiram: order.totalAmount.diram,
      pharmacyChainId,
    }
  }

  /** SRS-DOM-165 — см. JSDoc файла (ветка `tx` передан). */
  private async getOrderByIdLocking(tenantId: string, orderId: string, tx: PaymentsUnitOfWorkTx): Promise<PaymentsOrderSnapshot | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        pharmacyId: orders.pharmacyId,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        totalAmountTjs: orders.totalAmountTjs,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .for('update')
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const pharmacyChainId = await this.resolvePharmacyChainId(row.pharmacyId, client)
    return toSnapshot(row, pharmacyChainId)
  }

  /**
   * `pending_payment → paid_escrow` (SRS-PAY-018) — делегация буквальная: `OrdersFacade.
   * markPaidEscrow` сам вызывает `Order.markPaidEscrow()` (state machine + D-25 guard) и
   * `save()` НА ПЕРЕДАННОМ `tx` (SRS-ORD-027a) — см. JSDoc файла про предварительный лок.
   */
  // eslint-disable-next-line max-params -- сигнатура фиксирована интерфейсом `PaymentsOrdersPort.markPaidEscrow` (позиционные параметры порта, не выбор этого файла).
  public async markPaidEscrow(tenantId: string, orderId: string, txId: string, paidAt: Date, tx?: PaymentsUnitOfWorkTx): Promise<void> {
    await this.ordersFacade.markPaidEscrow(orderId, { tenantId, txId, paidAt, ledgerHoldWillBeRecorded: true }, tx)
  }

  /**
   * НЕ вызывается ни одним путём в периметре ЭТОГО тикета (SRS-PAY-027/`RefundOrderUseCase`,
   * DTJ-245 — первый реальный вызывающий код) — реализован ПОЛНОСТЬЮ, не заглушкой: канонический
   * адаптер порта обязан работать по контракту целиком, D-EP09-16 запрещает «заглушку,
   * отвечающую на денежный вопрос» РОВНО там, где адаптер ещё не готов, не здесь, где готов.
   * `actor.role === 'system'` → `{kind:'system'}` (ASSUMPTION — порт не несёт отдельного явного
   * признака «система», см. `PaymentsOrderActor` JSDoc; задокументировано в отчёте сдачи).
   */
  // eslint-disable-next-line max-params -- сигнатура фиксирована интерфейсом `PaymentsOrdersPort.cancel` (позиционные параметры порта, не выбор этого файла).
  public async cancel(
    tenantId: string,
    orderId: string,
    reason: string,
    actor: PaymentsOrderActor,
    tx?: PaymentsUnitOfWorkTx,
  ): Promise<void> {
    if (!isKnownCancelReason(reason)) {
      throw new Error(`OrdersFacadeAdapter.cancel: unknown cancel reason "${reason}" (SRS-ORD-030 canonical list)`)
    }
    const domainActor = actor.role === 'system' ? ({ kind: 'system' } as const) : ({ kind: 'user', userId: actor.userId } as const)
    await this.ordersFacade.cancel(orderId, { tenantId, reason, actor: domainActor, now: paidNow() }, tx)
  }

  private async resolvePharmacyChainId(pharmacyId: string | null, client: DrizzleDb): Promise<string | null> {
    if (pharmacyId === null) return null
    const rows = await client.select({ chainId: pharmacies.chainId }).from(pharmacies).where(eq(pharmacies.id, pharmacyId)).limit(1)
    return rows[0]?.chainId ?? null
  }
}

function toSnapshot(row: OrderLockRow, pharmacyChainId: string | null): PaymentsOrderSnapshot {
  if (row.status === null) {
    throw new Error(`orders.status is NULL for order ${row.id} — invalid data, cannot build PaymentsOrderSnapshot`)
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    pharmacyId: row.pharmacyId,
    status: row.status,
    paymentMethod: row.paymentMethod,
    totalAmountDiram: Money.fromDbDecimalTjs(row.totalAmountTjs).diram,
    pharmacyChainId,
  }
}

/**
 * `Order.cancel()` (`orders/domain/order.entity.ts`) требует `now: Date` — домен запрещает
 * `Date.now()` внутри СЕБЯ (`02` §2.6), но ЭТОТ файл — `infrastructure`, не `domain`/
 * `application` (правило применяется к тем двум слоям — `no-restricted-globals` конфига ESLint
 * ограничен путём `/(domain|application)/`, не всей кодовой базой). `cancel()` не вызывается
 * ни одним путём в периметре тикета (см. JSDoc метода) — `Date.now()` здесь не встречается ни в
 * одном текущем тесте/сценарии.
 */
function paidNow(): Date {
  return new Date()
}
