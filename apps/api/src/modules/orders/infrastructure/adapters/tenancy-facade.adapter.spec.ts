/**
 * `TenancyFacadeAdapter` (EP-09, DTJ-228/229) — быстрый unit-набор (без живого Postgres) на
 * `resolveCommissionRate` — правка по решению CTO (спор №1 отчёта сдачи): дефолт ПОКАТЕГОРИЙНЫЙ
 * (SRS-DOM-160), не единая ставка для всех. `getCodLimitDiram`/`getEnabledPaymentMethods` —
 * см. также `test/integration/orders/tenancy-facade.adapter.integration.spec.ts` (реальный
 * Postgres, конструктор адаптера идентичен).
 */
import { describe, expect, it, vi } from 'vitest'
import type { TenantSettingsRepositoryPort } from '@/modules/tenancy/index.js'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { TenancyFacadeAdapter } from './tenancy-facade.adapter.js'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

/** DTJ-304 — `getPartialFulfillmentConfirmationTimeoutMinutes` читает Drizzle напрямую (см. её JSDoc)
 *  — ни один тест ЭТОГО файла (без живого Postgres) её не вызывает, стаб никогда не разрешается. */
function stubDrizzleDb(): DrizzleDb {
  return {} as DrizzleDb
}

function makeAdapter(): TenancyFacadeAdapter {
  const repo: TenantSettingsRepositoryPort = {
    findByTenantId: vi.fn().mockResolvedValue(null),
    save: vi.fn(),
  }
  return new TenancyFacadeAdapter(repo, stubDrizzleDb())
}

describe('TenancyFacadeAdapter.resolveCommissionRate (SRS-DOM-160, решение CTO спор №1)', () => {
  const adapter = makeAdapter()

  it('rx → 500 bps', async () => {
    await expect(adapter.resolveCommissionRate(TENANT_ID, null, 'rx')).resolves.toBe(500)
  })

  it('otc → 800 bps', async () => {
    await expect(adapter.resolveCommissionRate(TENANT_ID, null, 'otc')).resolves.toBe(800)
  })

  it('parapharma → 1200 bps', async () => {
    await expect(adapter.resolveCommissionRate(TENANT_ID, null, 'parapharma')).resolves.toBe(1_200)
  })

  it('ставки трёх категорий попарно различаются (дефект спора №1 — единая ставка для всех — не воспроизводится)', async () => {
    const [rx, otc, parapharma] = await Promise.all([
      adapter.resolveCommissionRate(TENANT_ID, null, 'rx'),
      adapter.resolveCommissionRate(TENANT_ID, null, 'otc'),
      adapter.resolveCommissionRate(TENANT_ID, null, 'parapharma'),
    ])
    expect(new Set([rx, otc, parapharma]).size).toBe(3)
  })

  it('неизвестная категория → бросает, не подставляет правдоподобное значение (вопрос о деньгах, не о разрешении)', async () => {
    // @ts-expect-error — намеренно невалидная категория, проверка рантайм-защиты за границей типов
    await expect(adapter.resolveCommissionRate(TENANT_ID, null, 'unknown-category')).rejects.toThrow(
      /unrecognized commission category/,
    )
  })
})

describe('TenancyFacadeAdapter.getPickupSlaMinutes (DTJ-301, SRS-PHT-008/030)', () => {
  it('настройки тенанта отсутствуют (findByTenantId → null) → дефолт 7 минут (D-19)', async () => {
    const adapter = makeAdapter()
    await expect(adapter.getPickupSlaMinutes(TENANT_ID)).resolves.toBe(7)
  })

  it('настройки тенанта есть → читает pickupSlaMinutes, не дефолт', async () => {
    const repo: TenantSettingsRepositoryPort = {
      findByTenantId: vi.fn().mockResolvedValue({ pickupSlaMinutes: 12 }),
      save: vi.fn(),
    }
    const adapter = new TenancyFacadeAdapter(repo, stubDrizzleDb())
    await expect(adapter.getPickupSlaMinutes(TENANT_ID)).resolves.toBe(12)
  })
})
