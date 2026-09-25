import { describe, expect, it, vi } from 'vitest'
import type { FinancePage, ReconciliationAlertView, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { ListReconciliationAlertsUseCase } from './list-reconciliation-alerts.use-case.js'

const PAGE: FinancePage<ReconciliationAlertView> = {
  items: [
    {
      orderId: 'order-y',
      tenantId: 'tenant-1',
      discrepancyDiram: 500,
      repeatDetectionCount: 2,
      detectedAt: new Date('2026-09-10T00:00:00.000Z'),
    },
  ],
  nextCursor: null,
  hasMore: false,
}

function buildHarness() {
  const findReconciliationAlertsMock = vi.fn<PaymentsFacadePort['findReconciliationAlerts']>().mockResolvedValue(PAGE)
  const facade: PaymentsFacadePort = {
    findEscrowLedgerEntries: vi.fn(),
    findPayoutSchedule: vi.fn(),
    findReconciliationAlerts: findReconciliationAlertsMock,
  }
  const useCase = new ListReconciliationAlertsUseCase(facade)
  return { useCase, findReconciliationAlertsMock }
}

describe('ListReconciliationAlertsUseCase (DTJ-357)', () => {
  it('передаёт limit/cursor в PaymentsFacadePort.findReconciliationAlerts', async () => {
    const { useCase, findReconciliationAlertsMock } = buildHarness()
    const cursor = { v: '2026-09-09T00:00:00.000Z', id: 'order-x' }

    await useCase.execute({ limit: 20, cursor })

    expect(findReconciliationAlertsMock).toHaveBeenCalledWith({ limit: 20, cursor })
  })

  it('АС2 — алерт по заказу Y появляется в списке с суммой расхождения', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ limit: 20, cursor: null })

    expect(result.items).toEqual([expect.objectContaining({ orderId: 'order-y', discrepancyDiram: 500 })])
  })

  it('use case не несёт ни одного мутирующего метода (компиляционная гарантия — только execute)', () => {
    const useCase = new ListReconciliationAlertsUseCase({} as PaymentsFacadePort)
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(useCase))
    expect(methods).toEqual(['constructor', 'execute'])
  })
})
