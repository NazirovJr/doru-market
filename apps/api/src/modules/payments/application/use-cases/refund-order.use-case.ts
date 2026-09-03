/**
 * `RefundOrderUseCase` (EP-10, DTJ-245, SRS-DOM-092/179, SRS-PAY-015/017) — полный возврат
 * денег заказа. Единственный сценарий этого тикета — частичный возврат/раздельный биллинг
 * принадлежат EP-11 (`ReturnFinancialOutcomeResolver`), не дублируется здесь.
 *
 * `paymentMethod === 'cash_courier'` — ПЕРВЫЙ шаг (DoD DTJ-245), до любого сетевого/БД вызова:
 * наличные никогда не доходят до `paid_escrow` (D-25, `chk_orders_cash_never_escrow`,
 * `0027_orders_cash_never_escrow.sql`), `escrow_ledger` для них пуст на всём жизненном цикле
 * (D-EP09-29, тот же принцип, что уже реализован `CancelOrderUseCase.isRefundRequired` —
 * ПЕРЕИСПОЛЬЗУЕТСЯ здесь, не дублируется третьей копией: обе точки читают ОДИН и тот же факт
 * «наличные не создают эскроу», просто с разных сторон денежного ветвления — `CancelOrderUseCase`
 * решает, ВЫЗЫВАТЬ ли `RefundFacadePort` вообще (D-EP09-29 уже НЕ вызывает его для cash), а
 * этот NOOP — защита второго уровня на случай прямого вызова `RefundOrderUseCase` в обход
 * `CancelOrderUseCase` (например, будущим EP-11/14 use case'ом) с наличным заказом).
 *
 * **Идемпотентность, последовательный повтор** (AC3 DTJ-245) — READ-FIRST, тот же приём, что
 * `CreatePaymentInvoiceUseCase` (DTJ-241, `PaymentInvoiceCacheRepositoryPort.findCached` ДО
 * вызова провайдера): `escrow_ledger` УЖЕ несёт `refunded_to_customer`-запись → провайдер НЕ
 * вызывается повторно, метод — no-op. Буквальный текст тикета «идемпотентность через
 * payment_operations, ON CONFLICT DO NOTHING» НЕ реализован буквально — см. DISPUTED отчёта
 * сдачи: `MockBankProvider.refund()` (DTJ-238) уже САМ делает `INSERT ... ON CONFLICT
 * (idempotency_key) DO NOTHING` в ТУ ЖЕ таблицу под ТЕМ ЖЕ `idempotencyKey` (см.
 * `insertRefundOperation`) — конкурирующий `INSERT` с ЭТОГО use case'а вызвал бы ТОТ ЖЕ класс
 * дефекта, что уже задокументирован и обоснованно отклонён `CreatePaymentInvoiceUseCase`.
 *
 * **Реальная конкурентность** (`Promise.all` против живого Postgres, требование раздела
 * «Сдача» задания) — READ-FIRST выше НЕ гарантирует «ровно одна запись» под истинно
 * одновременными вызовами (TOCTOU: оба проходят check ДО того, как любой записал ledger).
 * Первая версия этого файла решала это `pg_advisory_xact_lock`/`SELECT ... FOR UPDATE` ВОКРУГ
 * ВСЕГО `execute()`, включая вызов `PaymentProvider.refund()` — живой прогон `Promise.all` (10
 * конкурентных вызовов) воспроизвёл РОВНО тот класс тупика пула соединений, что описан в
 * задании раздел «Жёсткие правила» п.2 (там — 20 соединений застряли на `begin`): держать
 * транзакцию/лок открытыми ЧЕРЕЗ внешний вызов (даже к `MockBankProvider`, который сам
 * независимо обращается к БД через ТОТ ЖЕ пул) при `pool.max=10` и десяти конкурентных
 * `execute()` исчерпывает пул — блокированные на локе держат соединения, активному держателю
 * не хватает соединения для СВОЕГО внутреннего запроса. Найдено и исправлено В ЭТОМ прогоне,
 * не оставлено как «известный компромисс R1» — деньги не терпят компромиссов на конкурентности.
 *
 * **Решение — частичный уникальный индекс на уровне БД**, не лок в коде: миграция
 * `0035_escrow_ledger_refund_unique.sql`, `UNIQUE(order_id) WHERE entry_type =
 * 'refunded_to_customer'` — атомарная гарантия «не более одной записи возврата на заказ» БЕЗ
 * удержания транзакции/соединения через `PaymentProvider.refund()`. `PaymentProvider.refund()`
 * вызывается СВОБОДНО, вне какой-либо транзакции (его собственная идемпотентность через
 * `payment_operations.idempotency_key`, SRS-PAY-003, защищает от второго реального возврата у
 * банка, даже если метод вызван несколько раз конкурентными гонщиками — тот же класс
 * гарантии, что уже принят `CreatePaymentInvoiceUseCase` для `createInvoice()`, см. её
 * интеграционный тест: там тоже НЕ утверждается «`createInvoice` вызван один раз» под
 * `Promise.all`, только «`payment_operations` содержит одну строку»). Финальная запись —
 * ОДИН `INSERT` (`EscrowLedgerRepository.append`, DTJ-240, без какого-либо `tx`); конфликт
 * уникального индекса (Postgres `23505`) перехватывается `catchConcurrentRefundConflict` НИЖЕ
 * как безопасный «заказ уже возвращён конкурентным вызовом», не как ошибка.
 *
 * `providerRef` для `PaymentProvider.refund()` — из `EscrowLedgerRepository.findByOrderId`,
 * запись `hold_created`, поле `paymentTransactionRef` (НЕ из `PaymentsOrdersPort.getOrderById`
 * буквально, вопреки тексту тикета «PaymentProvider.refund(order.paymentTransactionId, ...)») —
 * см. DISPUTED отчёта сдачи: `PaymentsOrderSnapshot` (`orders-facade.port.ts`, DTJ-236/248) НЕ
 * несёт этого поля, а расширение чужого порта вне `files_owned` этого тикета рискованнее, чем
 * переиспользование уже существующего `EscrowLedgerRepository` (DTJ-240, свой модуль) — та же
 * логика «ledger — единственный источник истины», что ticket сам применяет к `holdAmount`
 * (`sumByType('hold_created')`, НЕ `order.totalAmountDiram`).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import type { OrderCancelReason } from '@/modules/orders/index.js'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import {
  PAYMENTS_ORDERS_PORT,
  type PaymentsOrdersPort,
} from '@/modules/payments/application/ports/orders-facade.port.js'
import { PAYMENT_PROVIDER_TOKEN, type PaymentProvider } from '@/modules/payments/application/ports/payment-provider.port.js'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import {
  PAYOUT_SCHEDULE_REPOSITORY,
  type PayoutScheduleRepository,
} from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const CASH_PAYMENT_METHOD = 'cash_courier'
const HOLD_ENTRY_TYPE = 'hold_created'
const REFUNDED_ENTRY_TYPE = 'refunded_to_customer'
const CREDIT_DIRECTION = 'credit'
const REFUND_IDEMPOTENCY_KEY_PREFIX = 'refund'
/** Postgres SQLSTATE `unique_violation` — см. JSDoc файла «Решение — частичный уникальный индекс». */
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505'
/** Имя индекса из `0035_escrow_ledger_refund_unique.sql` — сверяется, чтобы не проглотить ЧУЖОЙ `23505`. */
const REFUND_UNIQUE_INDEX_NAME = 'ux_escrow_ledger_refunded_once'
const ZERO_DIRAM = 0n

export interface RefundOrderCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly reason: OrderCancelReason
}

@Injectable()
export class RefundOrderUseCase {
  // eslint-disable-next-line max-params -- 4 порта (PaymentsOrdersPort/PaymentProvider/EscrowLedgerRepository/PayoutScheduleRepository) + PINO_LOGGER. Явные @Inject на каждом параметре — esbuild/vitest не эмитит design:paramtypes (DTJ-001). Тот же приём, что CancelOrderUseCase (см. её JSDoc).
  constructor(
    @Inject(PAYMENTS_ORDERS_PORT) private readonly ordersPort: PaymentsOrdersPort,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly paymentProvider: PaymentProvider,
    @Inject(ESCROW_LEDGER_REPOSITORY) private readonly escrowLedger: EscrowLedgerRepository,
    @Inject(PAYOUT_SCHEDULE_REPOSITORY) private readonly payoutScheduleRepo: PayoutScheduleRepository,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: RefundOrderCommand): Promise<void> {
    const order = await this.ordersPort.getOrderById(cmd.tenantId, cmd.orderId)
    if (order === null) {
      // Invariant violation (D-EP09-35 style), не бизнес-ошибка: единственный вызывающий код
      // (`CancelOrderUseCase`/`RefundFacadeAdapter`) обязан гарантировать существование заказа
      // ДО вызова этого use case.
      throw new Error(
        `RefundOrderUseCase: order ${cmd.orderId} not found for tenant ${cmd.tenantId} — invariant violation, caller must validate existence first.`,
      )
    }
    if (order.paymentMethod === CASH_PAYMENT_METHOD) {
      this.logger.info({ orderId: cmd.orderId, reason: cmd.reason }, 'refund_noop_cash_order')
      return
    }
    if (await this.alreadyRefunded(cmd.tenantId, cmd.orderId)) {
      this.logger.info({ orderId: cmd.orderId }, 'refund_noop_already_refunded')
      return
    }

    await this.performRefund(cmd)
  }

  private async alreadyRefunded(tenantId: string, orderId: string): Promise<boolean> {
    const refunded = await this.escrowLedger.sumByType(tenantId, orderId, REFUNDED_ENTRY_TYPE)
    return refunded > ZERO_DIRAM
  }

  private async performRefund(cmd: RefundOrderCommand): Promise<void> {
    const holdAmount = await this.escrowLedger.sumByType(cmd.tenantId, cmd.orderId, HOLD_ENTRY_TYPE)
    const providerRef = await this.resolveHoldProviderRef(cmd.tenantId, cmd.orderId)

    const refundResult = await this.paymentProvider.refund(providerRef, deriveRefundIdempotencyKey(cmd.orderId))
    if (!refundResult.ok) {
      throw refundResult.error
    }

    // ВСЕГДА, независимо от того, выиграл ли этот вызов гонку за append() ниже (см. JSDoc файла):
    // реверс безопасен повторить (идемпотентен сам по себе, `PayoutScheduleRepository.
    // reverseIfExists`), не завязан на уникальный индекс escrow_ledger.
    await this.payoutScheduleRepo.reverseIfExists(cmd.tenantId, cmd.orderId)
    await this.appendRefundEntry(cmd, holdAmount, refundResult.value.providerRefundRef)
  }

  /** См. JSDoc файла «Решение — частичный уникальный индекс» — конфликт `23505` = безопасный no-op. */
  private async appendRefundEntry(cmd: RefundOrderCommand, holdAmount: bigint, providerRefundRef: string): Promise<void> {
    try {
      await this.escrowLedger.append(
        EscrowLedgerEntry.create({
          orderId: cmd.orderId,
          entryType: REFUNDED_ENTRY_TYPE,
          direction: CREDIT_DIRECTION,
          amountDiram: Money.fromDiram(holdAmount),
          paymentTransactionRef: providerRefundRef,
          reason: cmd.reason,
          actorUserId: null,
        }),
      )
      this.logger.info({ orderId: cmd.orderId, holdAmountDiram: holdAmount.toString() }, 'refund_issued')
    } catch (error) {
      if (!isConcurrentRefundConflict(error)) {
        throw error
      }
      this.logger.info({ orderId: cmd.orderId }, 'refund_noop_concurrent_winner')
    }
  }

  /** См. JSDoc файла — `hold_created`-запись, не `PaymentsOrdersPort`. */
  private async resolveHoldProviderRef(tenantId: string, orderId: string): Promise<string> {
    const entries = await this.escrowLedger.findByOrderId(tenantId, orderId)
    const holdEntry = entries.find((entry) => entry.entryType === HOLD_ENTRY_TYPE)
    if (holdEntry?.paymentTransactionRef == null) {
      throw new Error(
        `RefundOrderUseCase: missing '${HOLD_ENTRY_TYPE}' escrow entry with paymentTransactionRef for order ${orderId} — invariant violation (non-cash order must have a recorded hold before refund).`,
      )
    }
    return holdEntry.paymentTransactionRef
  }
}

/** Детерминирован по `orderId` (не `reason`): «полный рефанд» — одна логическая попытка на заказ (SRS-ORD-029, только один сценарий этого тикета). */
function deriveRefundIdempotencyKey(orderId: string): string {
  return `${REFUND_IDEMPOTENCY_KEY_PREFIX}:${orderId}`
}

/**
 * Duck-typed проверка (не `instanceof` — `pg`/`node-postgres` не экспортирует стабильный класс
 * ошибки через Drizzle) `unique_violation` ИМЕННО на `ux_escrow_ledger_refunded_once` — сверка
 * `constraint` вдобавок к `code`, чтобы не проглотить чужой `23505` (C12: пустой/слепой `catch`
 * запрещён, обогащённая проверка — нет). `drizzle-orm`'s `node-postgres`-драйвер оборачивает
 * сырую `pg` `DatabaseError` в СВОЮ ошибку — `code`/`constraint` живут на `error.cause`, не на
 * самом брошенном объекте (проверено живым прогоном против реального Postgres, см. отчёт
 * сдачи), поэтому проверяется именно `error.cause`.
 */
function isConcurrentRefundConflict(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined
  if (typeof cause !== 'object' || cause === null) return false
  const candidate = cause as { code?: unknown; constraint?: unknown }
  return candidate.code === POSTGRES_UNIQUE_VIOLATION_CODE && candidate.constraint === REFUND_UNIQUE_INDEX_NAME
}
