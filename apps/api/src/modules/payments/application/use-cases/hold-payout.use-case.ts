/**
 * `HoldPayoutUseCase` (EP-10, DTJ-249, SRS-DOM-058/105, SRS-PAY-030/032) — заморозка выплаты по
 * спору. Реализует `PaymentsFacade.holdPayout` (см. её JSDoc про публичный контракт для EP-14) —
 * `payments.module.ts` биндит `PAYMENTS_FACADE` на `useFactory`, делегирующий сюда (`execute`,
 * тот же метод-именование, что КАЖДЫЙ другой use case модуля — `CaptureEscrowUseCase`/
 * `AdjustLedgerUseCase`/`AdminPaymentOverrideUseCase` — а не `holdPayout`, чтобы не ломать
 * конвенцию ради формы ОДНОГО внешнего интерфейса).
 *
 * Единственная мутация — `PayoutScheduleRepository.holdIfPending` (один `UPDATE`, уже атомарен
 * на уровне БД) — не требуется `PaymentsUnitOfWorkPort`/транзакция (тот же приём, что
 * `AdjustLedgerUseCase`, единственная запись в `escrow_ledger`).
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  PAYOUT_SCHEDULE_REPOSITORY,
  type PayoutScheduleRepository,
} from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import type { HoldPayoutResult } from '@/modules/payments/application/ports/payments-facade.port.js'

export interface HoldPayoutCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly disputeId: string
}

@Injectable()
export class HoldPayoutUseCase {
  constructor(@Inject(PAYOUT_SCHEDULE_REPOSITORY) private readonly payoutScheduleRepo: PayoutScheduleRepository) {}

  /** AC2/AC3 DTJ-249 — см. JSDoc `PayoutScheduleRepository.holdIfPending`/`PaymentsFacade.holdPayout`. */
  async execute(cmd: HoldPayoutCommand): Promise<HoldPayoutResult> {
    const { held } = await this.payoutScheduleRepo.holdIfPending(cmd)
    return { alreadyPaid: !held }
  }
}
