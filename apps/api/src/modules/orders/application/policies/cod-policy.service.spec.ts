/**
 * `CodPolicyService` (EP-09, DTJ-229) — unit-набор: матрица Rx × лимит (4 комбинации, тест-план
 * тикета) поверх мока `TenancyFacadePort`.
 */
import { describe, expect, it, vi } from 'vitest'
import { CodForbiddenForRxError, CodLimitExceededError } from '@dorutj/contracts'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { CodPolicyService, type CodPolicyItemInput } from './cod-policy.service.js'

const TENANT_ID = 'tenant-1'
const COD_LIMIT_DIRAM = 50_000n

function makeService(codLimitDiram = COD_LIMIT_DIRAM): { service: CodPolicyService; getCodLimitDiram: ReturnType<typeof vi.fn> } {
  const getCodLimitDiram = vi.fn<TenancyFacadePort['getCodLimitDiram']>().mockResolvedValue(codLimitDiram)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram,
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes: vi.fn(),
  }
  return { service: new CodPolicyService(tenancyFacade), getCodLimitDiram }
}

function items(overrides: Partial<CodPolicyItemInput>[] = [{}]): CodPolicyItemInput[] {
  return overrides.map((o) => ({ medicineId: 'med-1', isPrescriptionRequired: false, ...o }))
}

describe('CodPolicyService (DTJ-229)', () => {
  it('non-Rx, сумма ≤ лимита → allowed (не бросает)', async () => {
    const { service } = makeService()
    await expect(service.isCodAllowed(items(), 40_000n, TENANT_ID)).resolves.toBeUndefined()
  })

  it('non-Rx, сумма > лимита → CodLimitExceededError', async () => {
    const { service } = makeService()
    await expect(service.isCodAllowed(items(), 60_000n, TENANT_ID)).rejects.toBeInstanceOf(CodLimitExceededError)
  })

  it('Rx-позиция, сумма ≤ лимита → CodForbiddenForRxError (Rx приоритетнее лимита)', async () => {
    const { service } = makeService()
    await expect(
      service.isCodAllowed(items([{ isPrescriptionRequired: true }]), 10_000n, TENANT_ID),
    ).rejects.toBeInstanceOf(CodForbiddenForRxError)
  })

  it('Rx-позиция, сумма > лимита → CodForbiddenForRxError (Rx-проверка первой)', async () => {
    const { service, getCodLimitDiram } = makeService()
    await expect(
      service.isCodAllowed(items([{ isPrescriptionRequired: true }]), 60_000n, TENANT_ID),
    ).rejects.toBeInstanceOf(CodForbiddenForRxError)
    expect(getCodLimitDiram).not.toHaveBeenCalled() // Rx коротит цепочку, лимит не запрашивается
  })

  it('AC2 — totalAmountDiram=60000 (>50000 дефолт), non-Rx → CodLimitExceededError', async () => {
    const { service } = makeService(50_000n)
    await expect(service.isCodAllowed(items(), 60_000n, TENANT_ID)).rejects.toBeInstanceOf(CodLimitExceededError)
  })

  it('сумма ровно на границе лимита (=) → allowed', async () => {
    const { service } = makeService(50_000n)
    await expect(service.isCodAllowed(items(), 50_000n, TENANT_ID)).resolves.toBeUndefined()
  })
})
