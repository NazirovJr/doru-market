/**
 * `PayoutExecutionJob` (EP-10, DTJ-250, `21-module-orders-payments-escrow.md` §6.3, SRS-PAY-033/
 * 034) — физическое исполнение выплаты аптеке, последний шаг денежного пути non-cash заказа.
 * `payout_schedule WHERE status='due'` (изоляция от `disputed` — SRS-PAY-032, сам `WHERE`, DTJ-249)
 * → батч → `BankPayoutTransferPort.transferBatch()` (через HTTP-мост, см. ниже) → `paid` ТОЛЬКО
 * подтверждённые строки, остальные остаются `due` для следующего прогона (SRS-PAY-034 — НЕ
 * оптимистичная пометка всего батча).
 *
 * АРХИТЕКТУРНОЕ РЕШЕНИЕ, ОТЛИЧНОЕ ОТ `UnpaidOrderTimeoutJob`/`PickupSlaTimeoutJob` (DTJ-253/254):
 * ЭТА джоба сама и СКАНИРУЕТ, и МУТИРУЕТ `payout_schedule` через СОБСТВЕННЫЙ `pg.Pool`
 * (`PgPayoutExecutionAdapter`) — `payout_schedule` не несёт доменного агрегата/state machine
 * (в отличие от `Order`), переход `due→paid` НЕ требует прохождения через `apps/api`-домен, что
 * подтверждает СОСЕДНИЙ тикет DTJ-249 (`PayoutSchedulerJob`, `pending→due`), КОТОРЫЙ ТОЖЕ мутирует
 * ту же таблицу напрямую из `apps/worker`, без HTTP-моста. Единственное, что физически ДОСТИЖИМО
 * только из `apps/api` — САМ вызов `BankPayoutTransferPort` (тикет прямо требует регистрации
 * адаптера в `payments.module.ts`, `apps/worker` не зависит от `@dorutj/api`) — поэтому мост
 * МИНИМАЛЕН: ТОЛЬКО `requestPayoutTransferBatch` (`POST /api/v1/internal/payouts/transfer-batch`,
 * `payout-transfer-batch.client.ts`), скан и финальный `UPDATE` — целиком здесь. Полное
 * обоснование — JSDoc `transfer-payout-batch.use-case.ts` (apps/api).
 *
 * Один HTTP-вызов на ВЕСЬ батч (не `Promise.allSettled` по одной строке, в отличие от DTJ-253/254
 * — там КАЖДЫЙ заказ отменяется НЕЗАВИСИМЫМ вызовом; здесь провайдер сам батчирует перевод) —
 * сетевой сбой ЭТОГО единственного вызова перехвачен `try/catch`, не роняет джобу целиком
 * (ничего не помечается `paid`, весь батч остаётся `due` до следующего тика — безопасный исход).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  API_INTERNAL_URL_TOKEN,
  INTERNAL_API_KEY_TOKEN,
  requestPayoutTransferBatch,
  type PayoutTransferBatchDeps,
  type PayoutTransferBatchRequestItem,
} from './payout-transfer-batch.client.js'
import { PAYOUT_BATCH_SIZE } from './payout-execution.constants.js'

export const PAYOUT_EXECUTION_STORE = Symbol.for('@dorutj/worker/payout-execution-store')

export interface DuePayoutRow {
  readonly payoutScheduleId: string
  readonly pharmacyMerchantRef: string
  readonly amountDiram: bigint
}

export interface PayoutExecutionStorePort {
  /** `payout_schedule` `WHERE status='due'`, батч ≤ `limit`, детерминированный порядок. */
  findDuePayouts(limit: number): Promise<readonly DuePayoutRow[]>
  /** `UPDATE payout_schedule SET status='paid', paid_at=NOW(), payout_batch_ref=:batchRef WHERE id = ANY(:ids)`. */
  markPaid(payoutScheduleIds: readonly string[], batchRef: string): Promise<void>
}

export interface PayoutExecutionResult {
  readonly scanned: number
  readonly paid: number
  readonly stillDue: number
}

/**
 * Агрегирует `PayoutExecutionStorePort` + `PAYOUT_BATCH_SIZE` в ОДИН инжектируемый параметр —
 * иначе конструктор `PayoutExecutionJob` нёс бы 4 параметра (порт + batchSize + 2 ENV-скаляра
 * URL/key), нарушая `max-params` ≤3 (C5). Тот же приём, что `EscrowReconciliationPorts`.
 */
@Injectable()
export class PayoutExecutionDeps {
  constructor(
    @Inject(PAYOUT_EXECUTION_STORE) public readonly store: PayoutExecutionStorePort,
    @Inject(PAYOUT_BATCH_SIZE) public readonly batchSize: number,
  ) {}
}

@Injectable()
export class PayoutExecutionJob {
  private readonly logger = new Logger(PayoutExecutionJob.name)
  private readonly store: PayoutExecutionStorePort
  private readonly batchSize: number

  // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
  constructor(
    deps: PayoutExecutionDeps,
    @Inject(API_INTERNAL_URL_TOKEN) private readonly apiInternalUrl: string,
    @Inject(INTERNAL_API_KEY_TOKEN) private readonly internalApiKey: string | undefined,
  ) {
    this.store = deps.store
    this.batchSize = deps.batchSize
  }

  /** Один тик: сканирует `due`-строки (лимит батча), переводит через HTTP-мост, помечает подтверждённые `paid`. */
  async runOnce(): Promise<PayoutExecutionResult> {
    const due = await this.store.findDuePayouts(this.batchSize)
    if (due.length === 0) {
      // AC4 DTJ-250: короткое замыкание ДО HTTP-вызова — R1-прод типично находит ноль строк
      // (ОЖИДАЕМОЕ состояние, SRS-PAY-033, не ошибка).
      this.logger.log('payout-execution: тик выполнен — due-строк нет (ожидаемое состояние R1-прода)')
      return { scanned: 0, paid: 0, stillDue: 0 }
    }

    const response = await this.transferBatchSafely(due)
    if (response.confirmedPayoutScheduleIds.length > 0 && response.batchRef !== null) {
      await this.store.markPaid(response.confirmedPayoutScheduleIds, response.batchRef)
    }

    const result: PayoutExecutionResult = {
      scanned: due.length,
      paid: response.confirmedPayoutScheduleIds.length,
      stillDue: due.length - response.confirmedPayoutScheduleIds.length,
    }
    this.logger.log(
      `payout-execution: тик выполнен — просканировано ${String(result.scanned)}, ` +
        `оплачено ${String(result.paid)}, осталось due ${String(result.stillDue)}`,
    )
    return result
  }

  /** Сетевой/адаптерный сбой ЕДИНСТВЕННОГО батч-вызова не должен ронять весь тик (см. JSDoc файла) — безопасный нулевой исход. */
  private async transferBatchSafely(
    due: readonly DuePayoutRow[],
  ): Promise<{ readonly batchRef: string | null; readonly confirmedPayoutScheduleIds: readonly string[] }> {
    const deps: PayoutTransferBatchDeps = { apiInternalUrl: this.apiInternalUrl, internalApiKey: this.internalApiKey }
    try {
      return await requestPayoutTransferBatch(deps, due.map(toRequestItem))
    } catch (error: unknown) {
      this.logger.error(`payout-execution: HTTP-мост transfer-batch упал — ${String(error)}`)
      return { batchRef: null, confirmedPayoutScheduleIds: [] }
    }
  }
}

function toRequestItem(row: DuePayoutRow): PayoutTransferBatchRequestItem {
  return { payoutScheduleId: row.payoutScheduleId, pharmacyMerchantRef: row.pharmacyMerchantRef, amountDiram: row.amountDiram.toString() }
}
