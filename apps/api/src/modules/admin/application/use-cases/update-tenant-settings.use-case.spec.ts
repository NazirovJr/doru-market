import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import type { TenancyFacadePort, TenantDetailView } from '../ports/tenancy-facade.port.js'
import { UpdateTenantSettingsUseCase } from './update-tenant-settings.use-case.js'

const ACTOR = { userId: 'super-admin-1' }

const UPDATED: TenantDetailView = {
  id: 'tenant-1',
  slug: 'apteka-vasco',
  isNeutral: false,
  customDomain: null,
  brandName: 'Vasco',
  brandLogoUrl: null,
  brandPalette: { '--brand-primary': '#123456' },
  codLimitDiram: 100_000,
  holdPeriodDays: 2,
}

function buildHarness(updateTenantSettingsResult: TenantDetailView | null = UPDATED) {
  const updateTenantSettingsMock = vi
    .fn<TenancyFacadePort['updateTenantSettings']>()
    .mockResolvedValue(updateTenantSettingsResult)
  const facade: TenancyFacadePort = {
    listTenants: vi.fn(),
    getTenantById: vi.fn(),
    updateTenantSettings: updateTenantSettingsMock,
  }
  const useCase = new UpdateTenantSettingsUseCase(facade)
  return { useCase, updateTenantSettingsMock }
}

describe('UpdateTenantSettingsUseCase', () => {
  it('валидный патч → вызывает facade.updateTenantSettings с точным payload', async () => {
    const { useCase, updateTenantSettingsMock } = buildHarness()

    const result = await useCase.execute({
      tenantId: 'tenant-1',
      rawPatch: { brandName: 'Vasco', codLimitDiram: 100_000, holdPeriodDays: 2 },
      actor: ACTOR,
    })

    expect(updateTenantSettingsMock).toHaveBeenCalledWith(
      'tenant-1',
      { brandName: 'Vasco', codLimitDiram: 100_000, holdPeriodDays: 2 },
      { userId: ACTOR.userId },
    )
    expect(result).toEqual(UPDATED)
  })

  it('невалидный codLimitDiram (-100) → ValidationError с details.field="codLimitDiram" ДО вызова facade', async () => {
    const { useCase, updateTenantSettingsMock } = buildHarness()

    const error = await useCase
      .execute({ tenantId: 'tenant-1', rawPatch: { codLimitDiram: -100 }, actor: ACTOR })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).details).toMatchObject({ field: 'codLimitDiram' })
    expect(updateTenantSettingsMock).not.toHaveBeenCalled()
  })

  it('невалидный HEX в brandPalette → ValidationError ДО вызова facade, БД (facade) не тронута', async () => {
    const { useCase, updateTenantSettingsMock } = buildHarness()

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        rawPatch: { brandPalette: { '--brand-primary': 'not-a-hex' } },
        actor: ACTOR,
      }),
    ).rejects.toThrow(ValidationError)
    expect(updateTenantSettingsMock).not.toHaveBeenCalled()
  })

  it('пустой патч ({}) → ValidationError (refine отвергает патч без полей)', async () => {
    const { useCase } = buildHarness()

    await expect(useCase.execute({ tenantId: 'tenant-1', rawPatch: {}, actor: ACTOR })).rejects.toThrow(ValidationError)
  })

  it('тенант не найден (facade вернул null) → NotFoundError', async () => {
    const { useCase } = buildHarness(null)

    await expect(
      useCase.execute({ tenantId: 'missing', rawPatch: { brandName: 'X' }, actor: ACTOR }),
    ).rejects.toThrow(NotFoundError)
  })
})
