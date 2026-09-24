import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import type { TenancyFacadePort, TenantDetailView } from '../ports/tenancy-facade.port.js'
import { GetTenantUseCase } from './get-tenant.use-case.js'

const TENANT: TenantDetailView = {
  id: 'tenant-1',
  slug: 'apteka-vasco',
  isNeutral: false,
  customDomain: null,
  brandName: 'Vasco',
  brandLogoUrl: null,
  brandPalette: {},
  codLimitDiram: 50_000,
  holdPeriodDays: 1,
}

function buildHarness(getTenantByIdResult: TenantDetailView | null) {
  const getTenantByIdMock = vi.fn<TenancyFacadePort['getTenantById']>().mockResolvedValue(getTenantByIdResult)
  const facade: TenancyFacadePort = {
    listTenants: vi.fn(),
    getTenantById: getTenantByIdMock,
    updateTenantSettings: vi.fn(),
  }
  const useCase = new GetTenantUseCase(facade)
  return { useCase, getTenantByIdMock }
}

describe('GetTenantUseCase', () => {
  it('тенант найден → возвращает TenantDetailView как есть', async () => {
    const { useCase, getTenantByIdMock } = buildHarness(TENANT)

    const result = await useCase.execute({ tenantId: 'tenant-1' })

    expect(getTenantByIdMock).toHaveBeenCalledWith('tenant-1')
    expect(result).toEqual(TENANT)
  })

  it('тенант не найден (facade вернул null) → NotFoundError', async () => {
    const { useCase } = buildHarness(null)

    await expect(useCase.execute({ tenantId: 'missing' })).rejects.toThrow(NotFoundError)
  })
})
