import { describe, expect, it, vi } from 'vitest'
import type { AdminPaymentOverrideUseCase } from '@/modules/payments/application/use-cases/admin-payment-override.use-case.js'
import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import type { JwtClaims } from '@/modules/auth/index.js'
import { AdminPaymentOverrideController } from './admin-payment-override.controller.js'

const CLAIMS = { sub: 'admin-1', role: 'super_admin' } as unknown as JwtClaims
const STORE: TenantContextStore = {
  tenantId: 'tenant-1',
  slug: 'demo',
  chainId: null,
  isNeutral: false,
  unresolved: false,
  unresolvedReason: null,
}

describe('AdminPaymentOverrideController (DTJ-246)', () => {
  it('маппит body + claims + resolveTenantId() в команду use case', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const useCase = { execute } as unknown as AdminPaymentOverrideUseCase
    const controller = new AdminPaymentOverrideController(useCase)

    const response = await TenantContext.run(STORE, () =>
      controller.override(
        {
          orderId: 'order-1',
          txId: 'manual-tx-1',
          amountDiram: 15_000n,
          paidAt: '2026-09-04T10:00:00.000Z',
          reason: 'confirmed by phone',
        },
        CLAIMS,
      ),
    )

    expect(response).toEqual({ data: { orderId: 'order-1' } })
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      txId: 'manual-tx-1',
      amountDiram: 15_000n,
      paidAt: new Date('2026-09-04T10:00:00.000Z'),
      reason: 'confirmed by phone',
      actorUserId: 'admin-1',
      actorRole: 'super_admin',
    })
  })
})
