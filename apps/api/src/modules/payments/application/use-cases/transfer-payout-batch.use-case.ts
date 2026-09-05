/**
 * `TransferPayoutBatchUseCase` (EP-10, DTJ-250, SRS-PAY-033/034) — вход исполнения payout-батча
 * для СИСТЕМНОГО инициатора (`PayoutExecutionJob`, `apps/worker`), не человека.
 *
 * МОСТ МЕЖДУ ПРОЦЕССАМИ (тот же класс архитектурного решения, что `SystemCancelOrderUseCase`,
 * DTJ-253/254, см. её JSDoc для полного обоснования — не повторяется здесь дословно): тикет
 * DTJ-250 пишет «`PayoutExecutionJob` ... вызывает `BankPayoutTransferPort.transferBatch()`»,
 * как будто джоба `apps/worker` может вызвать этот application-порт `apps/payments` напрямую.
 * Физически невозможно — `apps/worker` НЕ зависит от `@dorutj/api` (проверено:
 * `apps/worker/package.json` не содержит такой зависимости; см. также JSDoc
 * `escrow-reconciliation.job.ts`, тот же факт для DTJ-247). `BankPayoutTransferPort`/
 * `MockBankPayoutTransferProvider` физически МОГУТ жить только в DI-графе `apps/api`
 * (тикет сам явно требует регистрации в `payments.module.ts`) — единственный способ реально
 * исполнить банковский (пусть и мок) перевод из `apps/worker` — HTTP-мост:
 * `PayoutExecutionJob` шлёт `POST /api/v1/internal/payouts/transfer-batch`
 * (`payout-transfer-batch.controller.ts`) — ЭТОТ use case исполняется ВНУТРИ `apps/api` по
 * этому вызову.
 *
 * ЧТО ОСТАЁТСЯ НА СТОРОНЕ `apps/worker` (сознательное разделение, отличное от DTJ-253/254):
 * SQL-скан `payout_schedule WHERE status='due'` И финальный `UPDATE ... SET status='paid'`
 * — ОБА выполняются `apps/worker` напрямую через СОБСТВЕННЫЙ `pg.Pool` (`PgPayoutExecutionAdapter`,
 * `apps/worker/src/jobs/payout/`), а НЕ через этот use case. Обоснование: `payout_schedule` не
 * несёт доменного агрегата/state machine (в отличие от `Order`) — переход `due→paid` НЕ требует
 * прохождения через `apps/api`-домен, что подтверждает СОСЕДНИЙ тикет DTJ-249
 * (`PayoutSchedulerJob`, `pending→due`), который ТОЖЕ мутирует `payout_schedule` напрямую из
 * `apps/worker`, без HTTP-моста. Единственное, что физически ДОСТИЖИМО только из `apps/api` —
 * САМ вызов `BankPayoutTransferPort` (DI-граф), поэтому мост здесь МИНИМАЛЕН: этот use case НЕ
 * трогает `payout_schedule` вовсе, только транслирует батч в порт и возвращает результат —
 * `apps/worker` сам решает, какие строки пометить `paid`, на основании ответа.
 *
 * НИКОГДА не бросает (в отличие от `SystemCancelOrderUseCase`) — сбой перевода (полный или
 * частичный) для периодической payout-джобы НЕ исключительная ситуация, а рутинный, безопасный
 * исход («ничего не подтверждено в этот тик» — `payout_schedule` строки остаются `due`,
 * следующий прогон повторит попытку, SRS-PAY-034 «не оптимистичная пометка»).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { isOk } from '@dorutj/domain-kernel'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { BANK_PAYOUT_TRANSFER_PORT, type BankPayoutTransferPort, type PayoutTransferItem } from '@/modules/payments/application/ports/bank-payout-transfer.port.js'

export interface TransferPayoutBatchCommand {
  readonly payouts: readonly PayoutTransferItem[]
}

export interface TransferPayoutBatchOutcome {
  /** `null` — батч пуст ИЛИ адаптер не подтвердил НИ ОДНОЙ строки (безопасный дефолт). */
  readonly batchRef: string | null
  readonly confirmedPayoutScheduleIds: readonly string[]
}

@Injectable()
export class TransferPayoutBatchUseCase {
  public constructor(
    @Inject(BANK_PAYOUT_TRANSFER_PORT) private readonly port: BankPayoutTransferPort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  public async execute(cmd: TransferPayoutBatchCommand): Promise<TransferPayoutBatchOutcome> {
    // Defense-in-depth (AC4 DTJ-250 — пустой батч НЕ порождает адаптерный вызов): первая линия
    // защиты — сам `PayoutExecutionJob` (не шлёт HTTP вовсе на пустом скане), эта проверка —
    // вторая линия на случай прямого вызова use case в обход джобы (тот же приём, что явное
    // неисполнение вызова `RefundOrderUseCase` для cash-ветки в `SystemCancelOrderUseCase`).
    if (cmd.payouts.length === 0) {
      return { batchRef: null, confirmedPayoutScheduleIds: [] }
    }

    const result = await this.port.transferBatch(cmd.payouts)
    if (isOk(result)) {
      return { batchRef: result.value.batchRef, confirmedPayoutScheduleIds: cmd.payouts.map((p) => p.payoutScheduleId) }
    }
    return this.handleTransferError(result.error, cmd.payouts.length)
  }

  private handleTransferError(
    error: { readonly code: string; readonly message: string; readonly partialSuccess?: { readonly batchRef: string; readonly confirmedPayoutScheduleIds: readonly string[] } },
    requested: number,
  ): TransferPayoutBatchOutcome {
    if (error.partialSuccess !== undefined) {
      this.logger.warn(
        { code: error.code, requested, confirmed: error.partialSuccess.confirmedPayoutScheduleIds.length },
        'payout_transfer_batch_partial_failure',
      )
      return { batchRef: error.partialSuccess.batchRef, confirmedPayoutScheduleIds: error.partialSuccess.confirmedPayoutScheduleIds }
    }
    this.logger.error({ code: error.code, message: error.message, requested }, 'payout_transfer_batch_failed')
    return { batchRef: null, confirmedPayoutScheduleIds: [] }
  }
}
