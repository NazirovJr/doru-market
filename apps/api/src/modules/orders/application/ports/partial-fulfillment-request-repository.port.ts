/**
 * Порт `PartialFulfillmentRequestRepositoryPort` (EP-12, DTJ-304, модуль 24 §A.4, SRS-PHT-019..023a).
 *
 * DTJ-300 (`db/schema/order-partial-fulfillment-requests.ts`) завела ТОЛЬКО Drizzle-схему
 * (scaffolding-тикет, `layer: domain`, files_owned не включал ни порт, ни репозиторий — см.
 * её JSDoc/тикет) — этот файл, по обязательному правилу `02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §1.3 (application не знает `infrastructure`/Drizzle напрямую), заводит недостающий порт.
 * Тот же класс решения, что `EscrowLedgerRepository`/DTJ-240 (см. её JSDoc «не в буквальном
 * files_owned... по обязательному правилу»).
 *
 * `tenantId` — первый обязательный параметр КАЖДОГО read-метода (SRS-API-043/046, жёсткое
 * правило проекта): `order_partial_fulfillment_requests` НЕ несёт собственной колонки
 * `tenant_id` (канонная схема DTJ-300 — тенант резолвится ТОЛЬКО через `order_id →
 * orders.tenant_id`, тот же приём, что `EscrowLedgerRepository.findByOrderId`) — репозиторий
 * обязан JOIN'ить `orders` для скоупа, чужой тенант ⇒ `null` (SRS-API-046: существование
 * чужой строки не подтверждается).
 *
 * `transitionStatus` — единственный способ ПОКИНУТЬ `awaiting_customer`: условный
 * `UPDATE ... WHERE id = :id AND status = :fromStatus RETURNING` (не `SELECT` + `UPDATE`
 * отдельно — TOCTOU-гонка между явным ответом клиента и таймаутом, TC-PHT-013/SRS-PHT-023a).
 * `false` — строка уже покинула `fromStatus` ДО этого вызова (гонка проиграна, вызывающий
 * `ResolvePartialFulfillmentUseCase` обязан завершиться идемпотентным no-op, не бросать).
 * Тот же класс гарантии, что `ux_escrow_ledger_refunded_once` в `RefundOrderUseCase`
 * (DTJ-245) — атомарность на уровне БД, не блокировка/лок уровня приложения.
 */
import type { OrderItemIssueReason } from '@/modules/orders/domain/order-domain-event.js'
import type { OrderUnitOfWorkTx } from './order-repository.port.js'

export const PARTIAL_FULFILLMENT_REQUEST_REPOSITORY = Symbol.for('@dorutj/orders/partial-fulfillment-request-repository')

/** 1:1 `partial_fulfillment_status` enum (`db/schema/enums.schema.ts`, DTJ-300). */
export type PartialFulfillmentStatus = 'awaiting_customer' | 'confirmed' | 'rejected' | 'auto_confirmed_timeout'

/** 1:1 `order_partial_fulfillment_requests.items_snapshot` (JSONB, DTJ-300) — см. `PartialFulfillmentSnapshotItem`
 *  (`orders/domain/order-domain-event.ts`), локальный алиас ради независимости от доменного файла событий. */
export interface PartialFulfillmentSnapshotItemRecord {
  readonly orderItemId: string
  readonly medicineName: string
  readonly quantity: number
  readonly reason: OrderItemIssueReason
}

export interface PartialFulfillmentRequestRecord {
  readonly id: string
  readonly orderId: string
  readonly proposedBy: string
  readonly itemsSnapshot: readonly PartialFulfillmentSnapshotItemRecord[]
  readonly itemsTotalBeforeDiram: bigint
  readonly itemsTotalAfterDiram: bigint
  readonly refundAmountDiram: bigint
  readonly status: PartialFulfillmentStatus
  readonly idempotencyKey: string
  readonly requestedAt: Date
  readonly expiresAt: Date
  readonly respondedAt: Date | null
}

export interface CreatePartialFulfillmentRequestInput {
  readonly id: string
  readonly orderId: string
  readonly proposedBy: string
  readonly itemsSnapshot: readonly PartialFulfillmentSnapshotItemRecord[]
  readonly itemsTotalBeforeDiram: bigint
  readonly itemsTotalAfterDiram: bigint
  readonly refundAmountDiram: bigint
  readonly idempotencyKey: string
  readonly expiresAt: Date
}

export interface TransitionPartialFulfillmentStatusInput {
  readonly id: string
  readonly fromStatus: PartialFulfillmentStatus
  readonly toStatus: PartialFulfillmentStatus
  readonly respondedAt: Date
}

export interface PartialFulfillmentRequestRepositoryPort {
  /** Вставка новой строки (`status='awaiting_customer'` — DB-дефолт схемы). `tx` ОБЯЗАТЕЛЕН —
   *  создание запроса ВСЕГДА происходит в ТОЙ ЖЕ транзакции, что планирование BullMQ-джобы
   *  таймаута (`Что сделать` п.2 тикета), вызывающий код не должен иметь возможность забыть tx. */
  create(input: CreatePartialFulfillmentRequestInput, tx: OrderUnitOfWorkTx): Promise<PartialFulfillmentRequestRecord>

  /** См. JSDoc файла про `tenantId`-скоуп через JOIN `orders`. */
  findById(tenantId: string, requestId: string, tx?: OrderUnitOfWorkTx): Promise<PartialFulfillmentRequestRecord | null>

  /** См. JSDoc файла — CAS-переход, `false` при проигранной гонке (TC-PHT-013). `tx` ОБЯЗАТЕЛЕН —
   *  переход ВСЕГДА сопровождается пересчётом суммы заказа/outbox в той же транзакции. */
  transitionStatus(input: TransitionPartialFulfillmentStatusInput, tx: OrderUnitOfWorkTx): Promise<boolean>

  /**
   * ДОБАВЛЕНО (DTJ-305, EP-12 §A.5, SRS-PHT-026 п.2) — необходимое расширение порта (тот же
   * класс решения, что `InventoryFacadePort.getStockQuantity`/`reserveForOrder`, DTJ-224/302):
   * `CompletePickingUseCase` обязан убедиться, что для заказа с ≥1 `unavailable`-позицией
   * существует строка со `status ∈ {'confirmed', 'auto_confirmed_timeout'}` — ни один
   * существующий метод порта не отвечает на «есть ли строка для ЭТОГО orderId» (`findById`
   * требует `requestId`, который вызывающий на этом шаге не знает). `uxPartialFulfillmentOneActive`
   * (частичный уникальный индекс схемы, DTJ-300) гарантирует не более одной `awaiting_customer`
   * строки на заказ — `requestedAt DESC LIMIT 1` возвращает единственную практически возможную
   * «актуальную» строку. См. JSDoc файла про `tenantId`-скоуп через JOIN `orders`.
   */
  findLatestByOrderId(tenantId: string, orderId: string, tx?: OrderUnitOfWorkTx): Promise<PartialFulfillmentRequestRecord | null>
}
