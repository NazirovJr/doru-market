/**
 * `HandlePaymentWebhookUseCase` (EP-10, DTJ-242, `files_owned`, `21-module-orders-payments-
 * escrow.md` §5, SRS-DOM-089/164/165/180, SRS-ORD-027a, SRS-PAY-018..023) — сердце
 * эскроу-механики: ЕДИНСТВЕННЫЙ код-путь, которому разрешено перевести заказ в `paid_escrow`
 * (кроме `AdminPaymentOverrideUseCase`, DTJ-246, вне периметра этого тикета — SRS-PAY-018).
 *
 * Порядок ОБЯЗАТЕЛЬНО строго последовательный (SRS-PAY-020, ticket «Что сделать» п.2):
 *   1. Резолвить `BankWebhookVerifierPort` по `providerName` (`X-Payment-Provider`) — карта
 *      provider → verifier (`BankWebhookVerifierRegistryPort`). Не найден → `400
 *      WEBHOOK_PROVIDER_UNKNOWN` НЕМЕДЛЕННО — ни `verify()`, ни `JSON.parse` НЕ вызываются
 *      (AC4 DTJ-242).
 *   2. `verifier.verify(rawBody, headers)` — HMAC ПЕРВЫМ, JSON.parse — ВНУТРИ verify() (адаптер
 *      сам делает `JSON.parse` ТОЛЬКО ПОСЛЕ подтверждения подписи, см. JSDoc
 *      `MockBankWebhookVerifierAdapter`) — несовпадение → `401 INVALID_WEBHOOK_SIGNATURE`,
 *      `pino.warn` security-событие (НЕ `audit_log` — таблицы `audit_log` физически не
 *      существует до EP-16, `migrations/0031_app_role_privileges.sql` JSDoc; тот же приём,
 *      что `RefreshTokenUseCase.detectReuse`, DTJ-025), НЕ создаёт `support_ticket`
 *      автоматически (SRS-PAY-020 п.3 — частота ложных срабатываний сканеров).
 *   3. Резолвинг `orderId`/`tenantId` по `providerRef` (`PaymentWebhookOperationsPort.
 *      findOrderByProviderRef`) — ДО идемпотентной вставки: `payment_operations.order_id`
 *      (FK, NOT NULL) обязан быть известен заранее. `providerRef` неизвестен → SRS-PAY-028
 *      (вне `srs_refs` этого тикета) — `pino.warn`, `200 OK` без мутации (банк не должен
 *      бесконечно ретраить событие, которое мы не можем связать с заказом).
 *   4. ВСЁ остальное — ОДНА транзакция (`PaymentsUnitOfWorkPort.run`, правило 2 задания —
 *      участники транзакции получают ТОТ ЖЕ `tx`, никто не открывает свою):
 *      `INSERT payment_operations (idempotency_key=bankEventId) ON CONFLICT DO NOTHING` →
 *      конфликт (SRS-DOM-164, AC2) → COMMIT, `200 OK`, business-логика НЕ повторяется.
 *      Given вставлено И `type='payment_confirmed'`: `PaymentsOrdersPort.getOrderById(tx)`
 *      (SRS-DOM-165, `SELECT ... FOR UPDATE`) → `markPaidEscrow(tx)` (SRS-ORD-027a) →
 *      `EscrowLedgerRepository.append(hold_created, tx)` (SRS-DOM-180) → `PaymentsOutboxPort.
 *      append(OrderPaidEvent, tx)` → `COMMIT`.
 *   5. `payment_failed`/`refund_confirmed`/`refund_failed` — идемпотентная строка ВСЁ РАВНО
 *      записывается (защита от повторной обработки, если эти типы получат бизнес-логику
 *      позже), но `markPaidEscrow`/`EscrowLedger.append` НЕ вызываются — эти ветки
 *      ПРИНАДЛЕЖАТ `RefundOrderUseCase` (DTJ-245) и НЕ входят в `srs_refs` этого тикета
 *      (`SRS-PAY-018..023` — категорический запрет п.1 говорит буквально «кроме
 *      HandlePaymentWebhookUseCase», не «кроме любой его ветки» — но АС этого тикета (1-5)
 *      описывают ТОЛЬКО `payment_confirmed`; `payment_failed`/`refund_*` — задокументированный
 *      TODO(DTJ-245), не молчаливый пропуск).
 *
 * Ответ синхронный, БЕЗ исходящих сетевых вызовов (SRS-PAY-023) — `outbox`-публикация
 * АСИНХРОННА (`OutboxRelayWorker`, отдельный процесс), запись в `outbox` — быстрая
 * транзакционная INSERT, не блокирующий сетевой вызов.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import {
  BANK_WEBHOOK_VERIFIER_REGISTRY,
  type BankWebhookVerifierRegistryPort,
} from '@/modules/payments/application/ports/bank-webhook-verifier-registry.port.js'
import type { VerifiedWebhookPayload } from '@/modules/payments/application/ports/bank-webhook-verifier.port.js'
import {
  PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY,
  type PaymentWebhookOperationsPort,
} from '@/modules/payments/application/ports/payment-webhook-operations.port.js'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import {
  PAYMENTS_ORDERS_PORT,
  type PaymentsOrdersPort,
  type PaymentsUnitOfWorkTx,
} from '@/modules/payments/application/ports/orders-facade.port.js'
import { PAYMENTS_OUTBOX, type PaymentsOutboxPort } from '@/modules/payments/application/ports/payments-outbox.port.js'
import {
  PAYMENTS_UNIT_OF_WORK,
  type PaymentsUnitOfWorkPort,
} from '@/modules/payments/application/ports/payments-unit-of-work.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import type { OrderPaidEvent } from '@/modules/payments/domain/payment-domain-event.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { WebhookProviderUnknownError } from './errors/webhook-provider-unknown.error.js'

const PAYMENT_CONFIRMED: VerifiedWebhookPayload['type'] = 'payment_confirmed'
const SUCCEEDED_TYPES: readonly VerifiedWebhookPayload['type'][] = ['payment_confirmed', 'refund_confirmed']

@Injectable()
export class HandlePaymentWebhookUseCase {
  // eslint-disable-next-line max-params -- 7 DI-инъекций NestJS constructor injection (6 портов + pino-логгер), см. JSDoc файла для разбивки ответственности каждого.
  public constructor(
    @Inject(BANK_WEBHOOK_VERIFIER_REGISTRY) private readonly verifiers: BankWebhookVerifierRegistryPort,
    @Inject(PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY) private readonly webhookOperations: PaymentWebhookOperationsPort,
    @Inject(ESCROW_LEDGER_REPOSITORY) private readonly ledgerRepository: EscrowLedgerRepository,
    @Inject(PAYMENTS_ORDERS_PORT) private readonly ordersPort: PaymentsOrdersPort,
    @Inject(PAYMENTS_OUTBOX) private readonly outbox: PaymentsOutboxPort,
    @Inject(PAYMENTS_UNIT_OF_WORK) private readonly unitOfWork: PaymentsUnitOfWorkPort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  public async execute(rawBody: Buffer, headers: Record<string, string>, providerName: string): Promise<void> {
    const verifier = this.verifiers.resolve(providerName)
    if (verifier === null) {
      throw new WebhookProviderUnknownError(providerName)
    }
    const verified = verifier.verify(rawBody, headers)
    if (!verified.ok) {
      this.logger.warn({ providerName, rawBodyLength: rawBody.length }, 'payments.webhook.invalid_signature')
      throw verified.error
    }
    await this.processVerifiedPayload(providerName, verified.value)
  }

  private async processVerifiedPayload(providerName: string, payload: VerifiedWebhookPayload): Promise<void> {
    const original = await this.webhookOperations.findOrderByProviderRef(payload.providerRef)
    if (original === null) {
      // SRS-PAY-028 (вне srs_refs этого тикета) — «неизвестный платёж»: 200 OK, без мутации,
      // без спекулятивной payment_operations-строки (order_id NOT NULL, некуда вставить).
      this.logger.warn({ providerName, providerRef: payload.providerRef, bankEventId: payload.bankEventId }, 'payments.webhook.unknown_provider_ref')
      return
    }
    const ctx: WebhookContext = { providerName, payload, orderId: original.orderId, tenantId: original.tenantId }
    await this.unitOfWork.run((tx) => this.processWithinTransaction(ctx, tx))
  }

  private async processWithinTransaction(ctx: WebhookContext, tx: PaymentsUnitOfWorkTx): Promise<void> {
    const { providerName, payload, orderId } = ctx
    const inserted = await this.webhookOperations.recordEventIfNew(
      {
        bankEventId: payload.bankEventId,
        orderId,
        provider: providerName,
        providerRef: payload.providerRef,
        operationType: payload.type,
        succeeded: SUCCEEDED_TYPES.includes(payload.type),
        amountDiram: payload.amountDiram,
        rawWebhookPayload: toRawPayloadRecord(payload),
      },
      tx,
    )
    if (!inserted) return // AC2 — дубликат bankEventId, бизнес-логика не повторяется.
    if (payload.type !== PAYMENT_CONFIRMED) return // TODO(DTJ-245): payment_failed/refund_* — см. JSDoc файла п.5.
    await this.applyPaymentConfirmed(ctx, tx)
  }

  /** AC1 — `markPaidEscrow`/`EscrowLedger.append`/`outbox.append` в ОДНОЙ транзакции (`tx`). */
  private async applyPaymentConfirmed(ctx: WebhookContext, tx: PaymentsUnitOfWorkTx): Promise<void> {
    const { tenantId, orderId, payload } = ctx
    const order = await this.ordersPort.getOrderById(tenantId, orderId, tx)
    if (order === null) {
      throw new Error(`HandlePaymentWebhookUseCase: order ${orderId} vanished within its own transaction — data integrity violation`)
    }
    await this.ordersPort.markPaidEscrow(tenantId, orderId, payload.providerRef, payload.occurredAt, tx)
    await this.ledgerRepository.append(
      EscrowLedgerEntry.create({
        orderId,
        entryType: 'hold_created',
        direction: 'debit',
        amountDiram: Money.fromDiram(payload.amountDiram),
        paymentTransactionRef: payload.providerRef,
        reason: null,
        actorUserId: null,
      }),
      tx,
    )
    await this.outbox.append(tenantId, buildOrderPaidEvent(ctx, order.paymentMethod), tx)
  }
}

/** Объект-параметр (C5, `max-params` ≤3) — поля одного вебхука, разделяемые между приватными шагами. */
interface WebhookContext {
  readonly providerName: string
  readonly payload: VerifiedWebhookPayload
  readonly orderId: string
  readonly tenantId: string
}

function buildOrderPaidEvent(ctx: WebhookContext, paymentMethod: string): OrderPaidEvent {
  const { orderId, tenantId, payload } = ctx
  return {
    type: 'OrderPaidEvent',
    orderId,
    tenantId,
    paidAt: payload.occurredAt,
    paymentMethod,
    holdAmountDiram: payload.amountDiram.toString(),
    txId: payload.providerRef,
  }
}

/** `payment_operations.raw_webhook_payload` (jsonb) — верифицированная форма, не сырые байты (см. JSDoc файла). */
function toRawPayloadRecord(payload: VerifiedWebhookPayload): Record<string, unknown> {
  return {
    bankEventId: payload.bankEventId,
    providerRef: payload.providerRef,
    type: payload.type,
    amountDiram: payload.amountDiram.toString(),
    occurredAt: payload.occurredAt.toISOString(),
  }
}
