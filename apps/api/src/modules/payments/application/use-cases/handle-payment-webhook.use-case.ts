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
 *      `pino.warn` security-событие (НЕ `audit_log` — ИСПРАВЛЕНО при ревью DTJ-242 волны 7:
 *      таблица `audit_log` СУЩЕСТВУЕТ с миграции `0034_support_tickets_audit_log.sql`
 *      (заведена для DTJ-247, ПОСЛЕ того как был написан этот комментарий) — прежняя
 *      формулировка «таблицы не существует до EP-16» устарела. Реальная причина не писать
 *      сюда `audit_log` — структурная, не temporal: (а) `audit_log.entity_id UUID NOT NULL`,
 *      а на этом шаге `orderId` ЕЩЁ НЕ известен — `providerRef`/`orderId` резолвятся ТОЛЬКО
 *      из тела ПОСЛЕ успешной проверки подписи (см. п.3 ниже), подделанный вебхук до этого шага
 *      не доходит; (б) `audit_action_category` (та же миграция) не содержит значения,
 *      подходящего под «неаутентифицированная попытка без известной сущности» — только
 *      `payment_override`/`return_override`/`dispute_resolution`/`prescription_access`/
 *      `control_category_change`/`onboarding_decision`/`force_cancel_order`/`ledger_adjustment`.
 *      `pino.warn` — тот же приём, что `RefreshTokenUseCase.detectReuse`, DTJ-025), НЕ создаёт
 *      `support_ticket` автоматически (SRS-PAY-020 п.3 — частота ложных срабатываний сканеров).
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
  type OriginalPaymentOperationRef,
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
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/modules/payments/application/ports/audit-log.port.js'
import {
  LatePaymentRefundService,
  type LatePaymentRefundInput,
} from '@/modules/payments/application/services/late-payment-refund.service.js'
import { WebhookProviderUnknownError } from './errors/webhook-provider-unknown.error.js'
import { hashWebhookPayload } from './webhook-payload-hash.util.js'

const PAYMENT_CONFIRMED: VerifiedWebhookPayload['type'] = 'payment_confirmed'
const REFUND_CONFIRMED: VerifiedWebhookPayload['type'] = 'refund_confirmed'
const REFUND_FAILED: VerifiedWebhookPayload['type'] = 'refund_failed'
const SUCCEEDED_TYPES: readonly VerifiedWebhookPayload['type'][] = ['payment_confirmed', 'refund_confirmed']
const CANCELLED_STATUS = 'cancelled'
const UNKNOWN_PAYMENT_ACTION = 'unknown_payment_webhook'
const OUT_OF_ORDER_REFUND_ACTION = 'out_of_order_refund_webhook'

@Injectable()
export class HandlePaymentWebhookUseCase {
  // eslint-disable-next-line max-params -- 9 DI-инъекций (7 портов + сервис + pino-логгер), см. JSDoc файла для разбивки ответственности каждого. Дальнейшее дробление конструктора уменьшило бы явность графа зависимостей use case'а сильнее, чем экономит строк.
  public constructor(
    @Inject(BANK_WEBHOOK_VERIFIER_REGISTRY) private readonly verifiers: BankWebhookVerifierRegistryPort,
    @Inject(PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY) private readonly webhookOperations: PaymentWebhookOperationsPort,
    @Inject(ESCROW_LEDGER_REPOSITORY) private readonly ledgerRepository: EscrowLedgerRepository,
    @Inject(PAYMENTS_ORDERS_PORT) private readonly ordersPort: PaymentsOrdersPort,
    @Inject(PAYMENTS_OUTBOX) private readonly outbox: PaymentsOutboxPort,
    @Inject(PAYMENTS_UNIT_OF_WORK) private readonly unitOfWork: PaymentsUnitOfWorkPort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(LatePaymentRefundService) private readonly latePaymentRefund: LatePaymentRefundService,
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
    const original = await this.resolveOriginal(payload)
    if (original === null) {
      await this.handleUnknownPayment(payload)
      return
    }
    const ctx: WebhookContext = { providerName, payload, orderId: original.orderId, tenantId: original.tenantId }
    await this.unitOfWork.run((tx) => this.processWithinTransaction(ctx, tx))
  }

  /** DTJ-243, SRS-PAY-025 — refund-события резолвятся ЧЕРЕЗ РАНЕЕ созданную операцию рефанда
   * (`findRefundOperationRef`), НЕ через `findOrderByProviderRef` напрямую — см. JSDoc обоих
   * методов порта про разницу и про DISPUTED-отступление от `status='pending'`. */
  private resolveOriginal(payload: VerifiedWebhookPayload): Promise<OriginalPaymentOperationRef | null> {
    if (payload.type === REFUND_CONFIRMED || payload.type === REFUND_FAILED) {
      return this.webhookOperations.findRefundOperationRef(payload.providerRef)
    }
    return this.webhookOperations.findOrderByProviderRef(payload.providerRef)
  }

  /**
   * DTJ-243, SRS-PAY-028/040/025 — «неизвестный платёж» (общая ветка для ВСЕХ трёх пограничных
   * случаев: неизвестный `providerRef`, soft-deleted заказ — уже отфильтрован адаптером,
   * out-of-order refund): `200 OK` без мутации, `audit_log(category='payment_override')`.
   *
   * `support_ticket` СОЗНАТЕЛЬНО НЕ создаётся здесь (отступление от буквального текста тикета,
   * зафиксировано в отчёте сдачи DTJ-243, `assumptions`) — `support_tickets.tenant_id UUID
   * NOT NULL`, а `POST /api/v1/payments/webhook` — `@SkipTenantResolution()` (см. JSDoc
   * `payments-webhook.controller.ts`): тенант ФИЗИЧЕСКИ не резолвится для события, чей
   * `providerRef` не связан ни с одним заказом. `pino.warn` (ниже) + `audit_log` (nullable
   * `tenant_id`) — единственные доступные каналы алерта для этого конкретного под-случая.
   */
  private async handleUnknownPayment(payload: VerifiedWebhookPayload): Promise<void> {
    const isRefundEvent = payload.type === REFUND_CONFIRMED || payload.type === REFUND_FAILED
    const action = isRefundEvent ? OUT_OF_ORDER_REFUND_ACTION : UNKNOWN_PAYMENT_ACTION
    this.logger.warn({ providerRef: payload.providerRef, bankEventId: payload.bankEventId, action }, 'payments.webhook.unknown_payment')
    await this.auditLog.appendPaymentOverride({
      tenantId: null,
      entityId: null,
      action,
      metadata: {
        providerRef: payload.providerRef,
        bankEventId: payload.bankEventId,
        rawPayloadHash: hashWebhookPayload(payload),
      },
    })
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
    if (payload.type !== PAYMENT_CONFIRMED) return // payment_failed/refund_* — идемпотентная строка достаточна, доп. логики не требуется (DTJ-242 AC, сохранено).
    await this.applyPaymentConfirmedOrLateRefund(ctx, tx)
  }

  /** DTJ-243, SRS-PAY-027 — заказ может быть `cancelled` к моменту прихода `payment_confirmed`
   * (например, `UnpaidOrderTimeoutJob`, DTJ-253, обогнал банк) — тогда `markPaidEscrow` НЕ
   * вызывается (SRS-DOM-102, `cancelled` терминален), а `LatePaymentRefundService` берёт след. */
  private async applyPaymentConfirmedOrLateRefund(ctx: WebhookContext, tx: PaymentsUnitOfWorkTx): Promise<void> {
    const { tenantId, orderId, payload } = ctx
    const order = await this.ordersPort.getOrderById(tenantId, orderId, tx)
    if (order === null) {
      throw new Error(`HandlePaymentWebhookUseCase: order ${orderId} vanished within its own transaction — data integrity violation`)
    }
    if (order.status === CANCELLED_STATUS) {
      const input: LatePaymentRefundInput = { tenantId, orderId, amountDiram: payload.amountDiram, providerRef: payload.providerRef }
      await this.latePaymentRefund.handle(input, tx)
      return
    }
    await this.applyPaymentConfirmed(ctx, tx, order.paymentMethod)
  }

  /** AC1 — `markPaidEscrow`/`EscrowLedger.append`/`outbox.append` в ОДНОЙ транзакции (`tx`). */
  private async applyPaymentConfirmed(ctx: WebhookContext, tx: PaymentsUnitOfWorkTx, paymentMethod: string): Promise<void> {
    const { tenantId, orderId, payload } = ctx
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
    await this.outbox.append(tenantId, buildOrderPaidEvent(ctx, paymentMethod), tx)
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
