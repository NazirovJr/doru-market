import { describe, expect, it, vi } from 'vitest'
import type { FinancePage, EscrowLedgerEntryView, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { ListEscrowLedgerUseCase } from './list-escrow-ledger.use-case.js'

const PAGE: FinancePage<EscrowLedgerEntryView> = {
  items: [
    {
      orderId: 'order-1',
      entryType: 'hold_created',
      direction: 'debit',
      amountDiram: 10_000,
      reason: null,
      actorUserId: null,
      paymentTransactionRef: 'tx-1',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ],
  nextCursor: null,
  hasMore: false,
}

function buildHarness() {
  const findEscrowLedgerEntriesMock = vi.fn<PaymentsFacadePort['findEscrowLedgerEntries']>().mockResolvedValue(PAGE)
  const facade: PaymentsFacadePort = {
    findEscrowLedgerEntries: findEscrowLedgerEntriesMock,
    findPayoutSchedule: vi.fn(),
    findReconciliationAlerts: vi.fn(),
  }
  const useCase = new ListEscrowLedgerUseCase(facade)
  return { useCase, findEscrowLedgerEntriesMock }
}

describe('ListEscrowLedgerUseCase (DTJ-357)', () => {
  it('передаёт orderId/limit/cursor в PaymentsFacadePort.findEscrowLedgerEntries', async () => {
    const { useCase, findEscrowLedgerEntriesMock } = buildHarness()
    const cursor = { v: '2026-09-01T00:00:00.000Z', id: 'entry-1' }

    await useCase.execute({ orderId: 'order-1', limit: 20, cursor })

    expect(findEscrowLedgerEntriesMock).toHaveBeenCalledWith({ orderId: 'order-1' }, { limit: 20, cursor })
  })

  it('пробрасывает страницу без изменений (АС1 — хронологический порядок остаётся ответственностью facade)', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ orderId: 'order-1', limit: 20, cursor: null })

    expect(result).toEqual(PAGE)
  })

  it('use case не несёт ни одного мутирующего метода (компиляционная гарантия — только execute)', () => {
    const useCase = new ListEscrowLedgerUseCase({} as PaymentsFacadePort)
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(useCase))
    expect(methods).toEqual(['constructor', 'execute'])
  })
})
