/**
 * Тесты `runSeedPharmacies` — in-memory фейки репозиториев (без реальной БД,
 * тот же приём, что `seed-catalog.run.spec.ts`). Проверяет:
 * 1. Первый прогон создаёт сети + аптеки в статусе `active` + остатки.
 * 2. Повторный прогон идемпотентен: НЕ вызывает `PharmacyChain.create`/
 *    `PharmacyAccount.create` повторно (сущности уже существуют — короткое
 *    замыкание по `findById`), количество аптек/сетей не меняется.
 * 3. Остатки покрывают несколько аптек с разными ценами на один medicineId.
 */
import { describe, expect, it } from 'vitest'
import { EXISTING_PHARMACY_ID, runSeedPharmacies } from './seed-pharmacies.run.js'
import type { SeedPharmaciesDeps } from './seed-pharmacies.run.js'
import type { PharmacyChain } from '@/modules/onboarding/domain/pharmacy-chain.entity.js'
import { PharmacyAccount } from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import type { PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import type { PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import type { PharmacyInventoryRepository, UpsertInput } from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import type { CatalogMedicineForOffers } from './seed-pharmacy-offers.js'

function createFakeChainRepo(): PharmacyChainRepositoryPort & { store: Map<string, PharmacyChain> } {
  const store = new Map<string, PharmacyChain>()
  return {
    store,
    findById: (id) => Promise.resolve(store.get(id) ?? null),
    findByTinInn: () => Promise.resolve(null),
    listByStatus: () => Promise.resolve({ items: [], total: 0 }),
    save: (chain) => {
      store.set(chain.id, chain)
      return Promise.resolve()
    },
  }
}

function createFakeAccountRepo(): PharmacyAccountRepositoryPort & { store: Map<string, PharmacyAccount> } {
  const store = new Map<string, PharmacyAccount>()
  return {
    store,
    findById: (id) => Promise.resolve(store.get(id) ?? null),
    listByStatus: () => Promise.resolve({ items: [], total: 0 }),
    listByChain: () => Promise.resolve([]),
    save: (account) => {
      store.set(account.id, account)
      return Promise.resolve()
    },
  }
}

function createFakeInventoryRepo(): PharmacyInventoryRepository & { calls: UpsertInput[] } {
  const calls: UpsertInput[] = []
  return {
    calls,
    upsertMany: (input) => {
      calls.push(input)
      return Promise.resolve({ acceptedCount: input.rows.length, updatedCount: 0 })
    },
    findOrCreateManyByMedicineIds: () => Promise.resolve(new Map()),
    saveMany: () => Promise.resolve(),
  }
}

const FAKE_MEDICINES: readonly CatalogMedicineForOffers[] = [
  { id: 'med-1', tradeName: 'Парацетамол', substanceIds: ['sub-1'] },
  { id: 'med-2', tradeName: 'Панадол', substanceIds: ['sub-1'] }, // аналог med-1
  { id: 'med-3', tradeName: 'Ибупрофен', substanceIds: ['sub-2'] },
]

function buildDeps(overrides?: Partial<SeedPharmaciesDeps>): {
  deps: SeedPharmaciesDeps
  chainRepo: ReturnType<typeof createFakeChainRepo>
  accountRepo: ReturnType<typeof createFakeAccountRepo>
  inventoryRepo: ReturnType<typeof createFakeInventoryRepo>
} {
  const chainRepo = createFakeChainRepo()
  const accountRepo = createFakeAccountRepo()
  const inventoryRepo = createFakeInventoryRepo()
  const deps: SeedPharmaciesDeps = {
    chainRepo,
    accountRepo,
    inventoryRepo,
    listMedicinesWithSubstances: () => Promise.resolve(FAKE_MEDICINES),
    ...overrides,
  }
  return { deps, chainRepo, accountRepo, inventoryRepo }
}

describe('runSeedPharmacies', () => {
  it('первый прогон создаёт сети/аптеки в статусе active и остатки с разбросом цен', async () => {
    const { deps, chainRepo, accountRepo, inventoryRepo } = buildDeps()
    const now = new Date('2026-01-01')
    const result = await runSeedPharmacies(deps, now)

    expect(result.chainsEnsured).toBe(3)
    expect(result.pharmaciesEnsured).toBe(6)
    expect(chainRepo.store.size).toBe(3)
    expect(accountRepo.store.size).toBe(6)
    for (const chain of chainRepo.store.values()) {
      expect(chain.status).toBe('approved')
    }
    for (const account of accountRepo.store.values()) {
      expect(account.status).toBe('active')
      expect(account.isActive).toBe(true)
    }
    expect(inventoryRepo.calls.length).toBeGreaterThan(0)
    expect(result.offersUpserted).toBeGreaterThan(0)
    // EXISTING_PHARMACY_ID не найден в фейковом accountRepo → пул только из 6 новых.
    expect(result.pharmacyPoolSize).toBe(6)
  })

  it('повторный прогон идемпотентен: количество сетей/аптек не меняется, save() не бросает на активной сущности', async () => {
    const { deps, chainRepo, accountRepo } = buildDeps()
    const now = new Date('2026-01-01')
    await runSeedPharmacies(deps, now)
    const chainsAfterFirst = chainRepo.store.size
    const pharmaciesAfterFirst = accountRepo.store.size

    const second = await runSeedPharmacies(deps, now)

    expect(chainRepo.store.size).toBe(chainsAfterFirst)
    expect(accountRepo.store.size).toBe(pharmaciesAfterFirst)
    expect(second.chainsEnsured).toBe(3)
    expect(second.pharmaciesEnsured).toBe(6)
    for (const account of accountRepo.store.values()) {
      expect(account.status).toBe('active') // не откатился и не упал при повторном прогоне
    }
  })

  it('включает уже существующую аптеку в пул, если она найдена в accountRepo', async () => {
    const { deps, accountRepo } = buildDeps()
    const existing = PharmacyAccount.restore({
      id: EXISTING_PHARMACY_ID,
      chainId: 'existing-chain',
      name: 'Existing',
      addressText: 'addr',
      landmarkTj: null,
      latitude: 38.56,
      longitude: 68.78,
      phone: '+992900000000',
      is24_7: true,
      openingTime: null,
      closingTime: null,
      licenseNumber: 'LIC-0',
      licenseIssuingAuthority: null,
      licenseIssueDate: null,
      licenseExpiryDate: null,
      licenseScanUrl: null,
      pharmacistInChargeName: null,
      status: 'active',
      suspensionReason: null,
      isActive: true,
      submittedAt: null,
    })
    accountRepo.store.set(EXISTING_PHARMACY_ID, existing)

    const result = await runSeedPharmacies(deps, new Date('2026-01-01'))
    expect(result.pharmacyPoolSize).toBe(7)
  })

  it('одному medicineId соответствуют предложения нескольких аптек по разным ценам (сравнение цен)', async () => {
    const { deps, inventoryRepo } = buildDeps()
    await runSeedPharmacies(deps, new Date('2026-01-01'))

    const rowsByMedicine = new Map<string, number[]>()
    for (const call of inventoryRepo.calls) {
      for (const row of call.rows) {
        const bucket = rowsByMedicine.get(row.getMedicineId()) ?? []
        bucket.push(row.getPrice())
        rowsByMedicine.set(row.getMedicineId(), bucket)
      }
    }
    for (const [, prices] of rowsByMedicine) {
      expect(prices.length).toBeGreaterThanOrEqual(3)
      expect(new Set(prices).size).toBeGreaterThan(1)
    }
  })
})
