import { describe, expect, it, vi } from 'vitest'
import type { JwtClaims } from '@/modules/auth/index.js'
import type { GetBillingInvoicesQuery } from '@/modules/payments/application/queries/get-billing-invoices.query.js'
import { GetBillingInvoicesController } from './get-billing-invoices.controller.js'
import type { PharmacyReportRequestParams } from './pharmacy-report-request.decorator.js'

const CLAIMS: JwtClaims = {
  sub: 'user-1',
  role: 'pharmacy_admin',
  tenantId: 'tenant-1',
  pharmacyId: null,
  chainId: 'chain-a',
  sessionId: 'session-1',
}

function requestParams(overrides: Partial<PharmacyReportRequestParams> = {}): PharmacyReportRequestParams {
  return { pharmacyId: 'pharmacy-1', limitRaw: undefined, cursorRaw: undefined, statusFilterRaw: undefined, ...overrides }
}

describe('GetBillingInvoicesController (DTJ-252)', () => {
  it('парсит limit/cursor, вызывает GetBillingInvoicesQuery с actor из claims, кодирует meta.pagination', async () => {
    // Отдельная переменная (не `getBillingInvoices.execute`) — @typescript-eslint/unbound-method.
    const execute = vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
    const getBillingInvoices = { execute } as unknown as GetBillingInvoicesQuery
    const controller = new GetBillingInvoicesController(getBillingInvoices)

    const response = await controller.list(requestParams({ limitRaw: '15' }), CLAIMS)

    expect(execute).toHaveBeenCalledWith({
      pharmacyId: 'pharmacy-1',
      actor: { role: 'pharmacy_admin', chainId: 'chain-a' },
      limit: 15,
      cursor: null,
    })
    expect(response).toEqual({ data: [], meta: { pagination: { nextCursor: null, hasMore: false, limit: 15 } } })
  })
})
