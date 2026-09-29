import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NEUTRAL_FALLBACK_PALETTE, NotFoundError, ValidationError } from '@dorutj/contracts'
import { Tenant } from '../../domain/tenant.entity.js'
import { TenantSettings } from '../../domain/tenant-settings.entity.js'
import { TenantId } from '../../domain/value-objects/tenant-id.vo.js'
import { TenantSlug } from '../../domain/value-objects/tenant-slug.vo.js'
import type { TenantRepositoryPort } from '../ports/tenant-repository.port.js'
import { GetBrandingUseCase } from './get-branding.use-case.js'
import { UpdateBrandingUseCase, type UpdateBrandingCommand } from './update-branding.use-case.js'

const NEUTRAL_ID = '00000000-0000-4000-8000-000000000001'
const TENANT_ID = 'e0000000-0000-4000-8000-00000000a001'
const OTHER_TENANT_ID = 'e0000000-0000-4000-8000-00000000a002'
const CHAIN_ID = 'e0000000-0000-4000-8000-00000000c004'

function makeTenant(palette: Record<string, string>, isNeutral = false): Tenant {
  return Tenant.create(TenantId.from(isNeutral ? NEUTRAL_ID : TENANT_ID), TenantSlug.parse(isNeutral ? 'neutral' : 'sifat'), {
    chainId: isNeutral ? null : TenantId.from(CHAIN_ID),
    isNeutral,
    initialSettings: TenantSettings.createForProvision('Sifat', palette),
  })
}

function makeHarness(tenant: Tenant | null) {
  const save = vi.fn().mockResolvedValue(undefined)
  const publish = vi.fn().mockResolvedValue(undefined)
  const useCase = new UpdateBrandingUseCase(
    { findById: vi.fn().mockResolvedValue(tenant) } as unknown as TenantRepositoryPort,
    { findByTenantId: vi.fn(), save },
    { publishBrandingUpdated: publish },
  )
  return { useCase, save, publish }
}

const SUPER_ADMIN = { role: 'super_admin', tenantId: NEUTRAL_ID } as const
const OWN_ADMIN = { role: 'pharmacy_admin', tenantId: TENANT_ID } as const

function command(overrides: Partial<UpdateBrandingCommand> = {}): UpdateBrandingCommand {
  return {
    tenantId: TENANT_ID,
    rawRequest: { brandName: 'Sifat Plus', brandPalette: { '--brand-primary': '#0f766e' } },
    actor: SUPER_ADMIN,
    ...overrides,
  }
}

describe('UpdateBrandingUseCase', () => {
  it('сохраняет имя и палитру, сливая патч с существующей палитрой, и публикует событие', async () => {
    const { useCase, save, publish } = makeHarness(makeTenant({ '--brand-accent': '#f59e0b' }))

    await useCase.execute(command({ actor: OWN_ADMIN }))

    const saved = save.mock.calls[0]?.[0] as TenantSettings
    expect(saved.brandName).toBe('Sifat Plus')
    expect(saved.brandPalette).toEqual({ '--brand-accent': '#f59e0b', '--brand-primary': '#0f766e' })
    expect(publish).toHaveBeenCalledWith({ tenantId: TenantId.from(TENANT_ID), updatedFields: ['brandName', 'brandPalette'] })
  })

  it('logoUrl: не передан — сохраняется прежний; передан — меняется и попадает в updatedFields', async () => {
    const { useCase, save, publish } = makeHarness(makeTenant({}))
    await useCase.execute(command({ rawRequest: { brandName: 'X', brandPalette: {}, logoUrl: 'https://cdn.example.com/l.png' } }))
    expect((save.mock.calls[0]?.[0] as TenantSettings).brandLogoUrl).toBe('https://cdn.example.com/l.png')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ updatedFields: ['brandName', 'brandPalette', 'logoUrl'] }))
  })

  it.each(['url(javascript:alert(1))', '</style><script>alert(1)</script>'])(
    'невалидное значение %j → ValidationError, details.field=--brand-primary, БД не тронута',
    async (value) => {
      const { useCase, save, publish } = makeHarness(makeTenant({}))

      const error = await useCase
        .execute(command({ rawRequest: { brandName: 'X', brandPalette: { '--brand-primary': value } } }))
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).details).toMatchObject({ field: '--brand-primary' })
      expect(save).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    },
  )

  it('шрифт вне allowlist → ValidationError c полем токена', async () => {
    const { useCase } = makeHarness(makeTenant({}))
    const error = await useCase
      .execute(command({ rawRequest: { brandName: 'X', brandPalette: { '--brand-font-family': 'MyCustomHackerFont, sans-serif' } } }))
      .catch((e: unknown) => e)
    expect((error as ValidationError).details).toMatchObject({ field: '--brand-font-family' })
  })

  it('неизвестный токен → field указывает на него', async () => {
    const { useCase } = makeHarness(makeTenant({}))
    const error = await useCase.execute(command({ rawRequest: { brandName: 'X', brandPalette: { background: '#000000' } } })).catch((e: unknown) => e)
    expect((error as ValidationError).details).toMatchObject({ field: 'background' })
  })

  it('ошибка вне палитры → field=путь', async () => {
    const { useCase } = makeHarness(makeTenant({}))
    const error = await useCase.execute(command({ rawRequest: { brandName: '', brandPalette: {} } })).catch((e: unknown) => e)
    expect((error as ValidationError).details).toMatchObject({ field: 'brandName' })
  })

  it('pharmacy_admin чужого тенанта → ForbiddenError, палитра не тронута', async () => {
    const { useCase, save } = makeHarness(makeTenant({}))
    await expect(useCase.execute(command({ actor: { role: 'pharmacy_admin', tenantId: OTHER_TENANT_ID } }))).rejects.toBeInstanceOf(ForbiddenError)
    expect(save).not.toHaveBeenCalled()
  })

  it('pharmacy_admin нейтрального тенанта → ForbiddenError; super_admin — допустим', async () => {
    const { useCase } = makeHarness(makeTenant({}, true))
    await expect(
      useCase.execute(command({ tenantId: NEUTRAL_ID, actor: { role: 'pharmacy_admin', tenantId: NEUTRAL_ID } })),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(useCase.execute(command({ tenantId: NEUTRAL_ID }))).resolves.toBeUndefined()
  })

  it('pharmacy_admin несуществующего тенанта → ForbiddenError (не раскрываем существование), super_admin → NotFound', async () => {
    const { useCase } = makeHarness(null)
    await expect(useCase.execute(command({ actor: OWN_ADMIN }))).rejects.toBeInstanceOf(ForbiddenError)
    await expect(useCase.execute(command())).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('GetBrandingUseCase', () => {
  const run = (tenant: Tenant | null) =>
    new GetBrandingUseCase({ findById: vi.fn().mockResolvedValue(tenant) } as unknown as TenantRepositoryPort).execute({ tenantId: TENANT_ID })

  it('пустая палитра → NEUTRAL_FALLBACK_PALETTE', async () => {
    const result = await run(makeTenant({}))
    expect(result.palette).toEqual(NEUTRAL_FALLBACK_PALETTE)
    expect(result).toMatchObject({ slug: 'sifat', brandName: 'Sifat', logoUrl: null, faviconUrl: null, supportPhone: null })
  })

  it('заполненная палитра возвращается как есть', async () => {
    const result = await run(makeTenant({ '--brand-primary': '#0f766e' }))
    expect(result.palette).toEqual({ '--brand-primary': '#0f766e' })
  })

  it('несуществующий тенант → NotFoundError', async () => {
    await expect(run(null)).rejects.toBeInstanceOf(NotFoundError)
  })
})
