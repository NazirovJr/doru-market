/**
 * `AdjustLedgerUseCase` (EP-10, DTJ-246, SRS-DOM-063) — единственный способ учесть спор,
 * открытый ПОСЛЕ того, как аптеке уже выплачено (netting в следующий период). Готовый к вызову
 * use case для БУДУЩЕГО потребителя (EP-14) — сам вызывающий код спора вне периметра.
 *
 * НЕ проверяет `payout_schedule.status === 'paid'` сама (СОЗНАТЕЛЬНОЕ решение, буквальный текст
 * тикета «Что сделать» п.2) — это предусловие домена СПОРА (EP-14), не ledger: вне условия
 * `payout уже paid` спор использует `resolveRefundFull`/`Partial`, не adjustment. Если EP-14
 * вызовет БЕЗ проверки условия — расхождение возникнет на СТОРОНЕ вызывающего кода, не этого
 * тикета (см. «Риски» тикета).
 *
 * `reason`/`actorUserId` — обязательность проверяет ДОМЕН (`EscrowLedgerEntry.create`,
 * `AdjustmentRequiresReasonError` для `entryType='adjustment'` без них, DTJ-240) — этот use
 * case не дублирует проверку, целиком доверяет VO.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import { EscrowLedgerEntry, type EscrowEntryDirection } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

export interface AdjustLedgerCommand {
  readonly orderId: string
  readonly amountDiram: bigint
  readonly direction: EscrowEntryDirection
  readonly reason: string
  readonly actorUserId: string
}

@Injectable()
export class AdjustLedgerUseCase {
  constructor(@Inject(ESCROW_LEDGER_REPOSITORY) private readonly ledgerRepository: EscrowLedgerRepository) {}

  async execute(cmd: AdjustLedgerCommand): Promise<void> {
    await this.ledgerRepository.append(
      EscrowLedgerEntry.create({
        orderId: cmd.orderId,
        entryType: 'adjustment',
        direction: cmd.direction,
        amountDiram: Money.fromDiram(cmd.amountDiram),
        paymentTransactionRef: null,
        reason: cmd.reason,
        actorUserId: cmd.actorUserId,
      }),
    )
  }
}
