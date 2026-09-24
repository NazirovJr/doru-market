import { describe, expect, it, vi } from 'vitest'
import type { TenancyFacadePort, TenancyListPage } from '../ports/tenancy-facade.port.js'
import { ListTenantsUseCase } from './list-tenants.use-case.js'

const PAGE: TenancyListPage = {
  items: [
    {
      id: 'tenant-1',
      slug: 'apteka-vasco',
      isNeutral: false,
      customDomain: null,
      brandName: 'Vasco',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ],
  nextCursor: { v: '2026-09-01T00:00:00.000Z', id: 'tenant-1' },
  hasMore: true,
}

function buildHarness() {
  const listTenantsMock = vi.fn<TenancyFacadePort['listTenants']>().mockResolvedValue(PAGE)
  const facade: TenancyFacadePort = {
    listTenants: listTenantsMock,
    getTenantById: vi.fn(),
    updateTenantSettings: vi.fn(),
  }
  const useCase = new ListTenantsUseCase(facade)
  return { useCase, listTenantsMock }
}

describe('ListTenantsUseCase', () => {
  it('передаёт limit/cursor из command в facade.listTenants без изменений', async () => {
    const { useCase, listTenantsMock } = buildHarness()
    const cursor = { v: '2026-08-01T00:00:00.000Z', id: 'anchor' }

    await useCase.execute({ limit: 20, cursor })

    expect(listTenantsMock).toHaveBeenCalledWith({ limit: 20, cursor })
  })

  it('cursor отсутствует в command → facade.listTenants получает cursor: null', async () => {
    const { useCase, listTenantsMock } = buildHarness()

    await useCase.execute({ limit: 20 })

    expect(listTenantsMock).toHaveBeenCalledWith({ limit: 20, cursor: null })
  })

  it('пробрасывает items/nextCursor/hasMore без изменений (критерий приёмки 1 — все тенанты)', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ limit: 20 })

    expect(result).toEqual(PAGE)
  })
})
