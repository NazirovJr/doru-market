import { describe, expect, it, vi } from 'vitest'
import type { OnboardingFacadePort } from '@/modules/payments/application/ports/onboarding-facade.port.js'
import { SuspendChainForUnpaidInvoiceController } from './suspend-chain-for-unpaid-invoice.controller.js'

describe('SuspendChainForUnpaidInvoiceController (DTJ-252)', () => {
  it('маппит :id в вызов OnboardingFacadePort.suspendChain, возвращает { suspended: true }', async () => {
    const suspendChain = vi.fn().mockResolvedValue(undefined)
    const onboardingFacade = { suspendChain } as unknown as OnboardingFacadePort
    const controller = new SuspendChainForUnpaidInvoiceController(onboardingFacade)

    const response = await controller.suspend('chain-1')

    expect(suspendChain).toHaveBeenCalledExactlyOnceWith('chain-1')
    expect(response).toEqual({ data: { suspended: true } })
  })
})
