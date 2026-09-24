/**
 * `CaptureEscrowUseCase` (EP-10, DTJ-244, SRS-DOM-032/095/152, SRS-PAY-012/017/017a/031) —
 * ЕДИНСТВЕННЫЙ вызывающий код для `platform_fee_captured`/`captured_to_pharmacy` (DoD тикета).
 * Подписан на `OrderDeliveredEvent` (модуль `delivery`, EP-13 — публикующая сторона ВНЕ
 * периметра этого тикета, см. JSDoc `OrderDeliveredSubscriber`), не вызывается ни одним
 * контроллером напрямую.
 *
 * `cash_courier` — намеренный NOOP (SRS-PAY-017/017a): комиссия за наличные — отдельный B2B-цикл
 * (`CashCommissionAggregationJob`, DTJ-251), не через ledger — D-25.
 *
 * Идемпотентность — ДВЕ независимые линии защиты: `ProcessedEventsPort` (at-least-once
 * delivery события, SRS-DOM-152, ПЕРВИЧНАЯ) и `PayoutScheduleRepository.insertPending`'s
 * `ON CONFLICT (order_id) DO NOTHING` (защита от программной ошибки/повторного вызова с ДРУГИМ
 * `eventId`, ВТОРИЧНАЯ, defense-in-depth).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import {
  PAYMENTS_ORDERS_PORT,
  type PaymentsOrderSnapshot,
  type PaymentsOrdersPort,
  type PaymentsUnitOfWorkTx,
} from '@/modules/payments/application/ports/orders-facade.port.js'
import {
  PAYMENTS_UNIT_OF_WORK,
  type PaymentsUnitOfWorkPort,
} from '@/modules/payments/application/ports/payments-unit-of-work.port.js'
import { PAYMENTS_TENANCY_PORT, type PaymentsTenancyPort } from '@/modules/payments/application/ports/tenancy-facade.port.js'
import { PROCESSED_EVENTS_PORT, type ProcessedEventsPort } from '@/common/events/processed-events.port.js'
import {
  PAYOUT_SCHEDULE_REPOSITORY,
  type PayoutScheduleRepository,
} from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const CONSUMER_NAME = 'payments.on-delivered'
const CASH_PAYMENT_METHOD = 'cash_courier'
const ZERO_DIRAM = 0n

export interface CaptureEscrowCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly eventId: string
}

@Injectable()
export class CaptureEscrowUseCase {
  // eslint-disable-next-line max-params -- 6 портов (ProcessedEvents/OrdersPort/EscrowLedger/PayoutSchedule/Tenancy/UnitOfWork) + PINO_LOGGER — тот же класс состава, что HandlePaymentWebhookUseCase (см. её JSDoc).
  constructor(
    @Inject(PROCESSED_EVENTS_PORT) private readonly processedEvents: ProcessedEventsPort,
    @Inject(PAYMENTS_ORDERS_PORT) private readonly ordersPort: PaymentsOrdersPort,
    @Inject(ESCROW_LEDGER_REPOSITORY) private readonly ledgerRepository: EscrowLedgerRepository,
    @Inject(PAYOUT_SCHEDULE_REPOSITORY) private readonly payoutScheduleRepo: PayoutScheduleRepository,
    @Inject(PAYMENTS_TENANCY_PORT) private readonly tenancyPort: PaymentsTenancyPort,
    @Inject(PAYMENTS_UNIT_OF_WORK) private readonly unitOfWork: PaymentsUnitOfWorkPort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: CaptureEscrowCommand): Promise<void> {
    await this.unitOfWork.run((tx) => this.processWithinTransaction(cmd, tx))
  }

  private async processWithinTransaction(cmd: CaptureEscrowCommand, tx: PaymentsUnitOfWorkTx): Promise<void> {
    const isNew = await this.processedEvents.markProcessed(CONSUMER_NAME, cmd.eventId, tx)
    if (!isNew) return // SRS-PAY-012 — at-least-once, уже обработано.

    const order = await this.ordersPort.getOrderById(cmd.tenantId, cmd.orderId, tx)
    if (order === null) {
      throw new Error(`CaptureEscrowUseCase: order ${cmd.orderId} not found for tenant ${cmd.tenantId} — invariant violation.`)
    }
    if (order.paymentMethod === CASH_PAYMENT_METHOD) {
      this.logger.info({ orderId: cmd.orderId }, 'capture_escrow_noop_cash_order') // SRS-PAY-017/017a — ожидаемая ветка, не ошибка.
      return
    }
    await this.captureNonCash(cmd, order, tx)
  }

  private async captureNonCash(cmd: CaptureEscrowCommand, order: PaymentsOrderSnapshot, tx: PaymentsUnitOfWorkTx): Promise<void> {
    if (order.pharmacyId === null) {
      throw new Error(`CaptureEscrowUseCase: order ${cmd.orderId} has no pharmacyId — cannot create payout_schedule.`)
    }
    const commissionDiram = sumPlatformFee(order.items)
    const netAmountDiram = order.totalAmountDiram - commissionDiram
    await this.appendCaptureEntries({ orderId: cmd.orderId, commissionDiram, netAmountDiram, tx })

    const settings = await this.tenancyPort.getTenantSettings(cmd.tenantId)
    await this.payoutScheduleRepo.insertPending(
      {
        orderId: cmd.orderId,
        pharmacyId: order.pharmacyId,
        grossAmountDiram: order.totalAmountDiram,
        commissionDiram,
        netAmountDiram,
        holdPeriodDays: settings.holdPeriodDays,
      },
      tx,
    )
  }

  /** `EscrowLedgerEntry.create` требует СТРОГО положительную сумму (SRS-DOM-067) — заказ БЕЗ
   * комиссии (все позиции `commissionBps=0`, легальная бизнес-конфигурация) дал бы `0n` и бросил
   * бы `InvalidMoneyError`. `platform_fee_captured` в этом случае — не финансовое событие
   * (нечего захватывать), пропускается; `captured_to_pharmacy` получает ПОЛНУЮ сумму
   * (net = gross), баланс инварианта (SRS-PAY-010) не нарушается: hold − (0 + gross) = 0. */
  private async appendCaptureEntries(cmd: { orderId: string; commissionDiram: bigint; netAmountDiram: bigint; tx: PaymentsUnitOfWorkTx }): Promise<void> {
    if (cmd.commissionDiram > ZERO_DIRAM) {
      await this.appendEntry({ orderId: cmd.orderId, entryType: 'platform_fee_captured', amountDiram: cmd.commissionDiram, tx: cmd.tx })
    }
    await this.appendEntry({ orderId: cmd.orderId, entryType: 'captured_to_pharmacy', amountDiram: cmd.netAmountDiram, tx: cmd.tx })
  }

  private async appendEntry(cmd: {
    orderId: string
    entryType: 'platform_fee_captured' | 'captured_to_pharmacy'
    amountDiram: bigint
    tx: PaymentsUnitOfWorkTx
  }): Promise<void> {
    await this.ledgerRepository.append(
      EscrowLedgerEntry.create({
        orderId: cmd.orderId,
        entryType: cmd.entryType,
        direction: 'credit',
        amountDiram: Money.fromDiram(cmd.amountDiram),
        paymentTransactionRef: null,
        reason: null,
        actorUserId: null,
      }),
      cmd.tx,
    )
  }
}

function sumPlatformFee(items: PaymentsOrderSnapshot['items']): bigint {
  return items.reduce((sum, item) => sum + item.platformFeeDiram, ZERO_DIRAM)
}
