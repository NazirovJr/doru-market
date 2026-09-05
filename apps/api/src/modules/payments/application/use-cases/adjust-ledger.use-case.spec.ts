/**
 * Unit-тесты `AdjustLedgerUseCase` (EP-10, DTJ-246, SRS-DOM-063).
 */
import { describe, expect, it, vi } from 'vitest'
import { AdjustmentRequiresReasonError } from '@/modules/payments/domain/errors/adjustment-requires-reason.error.js'
import type { EscrowLedgerRepository } from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import { AdjustLedgerUseCase, type AdjustLedgerCommand } from './adjust-ledger.use-case.js'

function buildHarness() {
  const append = vi.fn<EscrowLedgerRepository['append']>().mockResolvedValue(undefined)
  const ledgerRepository = { append } as unknown as EscrowLedgerRepository
  const useCase = new AdjustLedgerUseCase(ledgerRepository)
  return { useCase, append }
}

const CMD: AdjustLedgerCommand = {
  orderId: 'order-1',
  amountDiram: 500n,
  direction: 'debit',
  reason: 'dispute #42 resolved in favor of pharmacy after payout',
  actorUserId: 'support-1',
}

describe('AdjustLedgerUseCase (DTJ-246)', () => {
  it('AC4: direction=debit → escrow_ledger получает adjustment(direction=debit) с reason/actorUserId', async () => {
    const h = buildHarness()

    await h.useCase.execute(CMD)

    expect(h.append).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ orderId: 'order-1', entryType: 'adjustment', direction: 'debit', reason: CMD.reason, actorUserId: 'support-1' }),
    )
  })

  it('direction=credit — обратный знак', async () => {
    const h = buildHarness()

    await h.useCase.execute({ ...CMD, direction: 'credit' })

    expect(h.append.mock.calls[0]![0]).toMatchObject({ direction: 'credit' })
  })

  it('без reason/actorUserId — домен (EscrowLedgerEntry.create) бросает AdjustmentRequiresReasonError, use case её не проглатывает', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute({ ...CMD, reason: '' })).rejects.toBeInstanceOf(AdjustmentRequiresReasonError)
    expect(h.append).not.toHaveBeenCalled()
  })
})
