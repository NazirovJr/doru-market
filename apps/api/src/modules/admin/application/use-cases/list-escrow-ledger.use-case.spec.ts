import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import type { EscrowLedgerEntryView, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { ListEscrowLedgerUseCase } from './list-escrow-ledger.use-case.js'

const ENTRIES: readonly EscrowLedgerEntryView[] = [
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
]

function buildHarness() {
  const findEscrowLedgerEntriesMock = vi.fn<PaymentsFacadePort['findEscrowLedgerEntries']>().mockResolvedValue(ENTRIES)
  const facade: PaymentsFacadePort = {
    findEscrowLedgerEntries: findEscrowLedgerEntriesMock,
    findPayoutSchedule: vi.fn(),
    findPayoutScheduleByOrder: vi.fn(),
    listBillingInvoices: vi.fn(),
    getBillingInvoiceById: vi.fn(),
    markInvoicePaid: vi.fn(),
    listCommissionRates: vi.fn(),
    upsertCommissionRate: vi.fn(),
  }
  const useCase = new ListEscrowLedgerUseCase(facade)
  return { useCase, findEscrowLedgerEntriesMock }
}

describe('ListEscrowLedgerUseCase (DTJ-357)', () => {
  it('передаёт orderId в PaymentsFacadePort.findEscrowLedgerEntries', async () => {
    const { useCase, findEscrowLedgerEntriesMock } = buildHarness()

    await useCase.execute({ orderId: 'order-1' })

    expect(findEscrowLedgerEntriesMock).toHaveBeenCalledWith('order-1')
  })

  it('пробрасывает список записей без изменений (АС1 — хронологический порядок остаётся ответственностью facade)', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ orderId: 'order-1' })

    expect(result).toEqual(ENTRIES)
  })

  it('orderId отсутствует → ValidationError, facade не вызывается', async () => {
    const { useCase, findEscrowLedgerEntriesMock } = buildHarness()

    await expect(useCase.execute({})).rejects.toThrow(ValidationError)
    expect(findEscrowLedgerEntriesMock).not.toHaveBeenCalled()
  })

  it('orderId — пустая строка → ValidationError', async () => {
    const { useCase } = buildHarness()

    await expect(useCase.execute({ orderId: '   ' })).rejects.toThrow(ValidationError)
  })

  it('use case не несёт ни одного мутирующего метода (компиляционная гарантия — только execute)', () => {
    const useCase = new ListEscrowLedgerUseCase({} as PaymentsFacadePort)
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(useCase))
    expect(methods).toEqual(['constructor', 'execute'])
  })
})
