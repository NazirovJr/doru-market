/**
 * Seed демо-аптек и остатков (демо-стенд, задача «данные для сравнения цен»).
 *
 * Зачем отдельный модуль, а не расширение `seed-catalog.ts`/`seed-catalog.port.ts`:
 * каталог (`medicines`/`substances`/`categories`) — один bounded context (домен
 * `catalog`, фабрика `Medicine.create()`, единственный шаг валидации). Аптеки и
 * остатки — ДВА других bounded context'а (`onboarding`: `PharmacyChain`/
 * `PharmacyAccount` — многошаговый state machine `draft→pending_review→approved→
 * active`; `inventory`: `InventoryBatchUpsertRow` — построчная валидация батча).
 * У каждого уже есть готовые доменные фабрики и ПРОДАКШЕН-репозитории
 * (`DrizzlePharmacyChainRepository`, `DrizzlePharmacyAccountRepository`,
 * `DrizzlePharmacyInventoryRepository`) — этот файл их ПЕРЕИСПОЛЬЗУЕТ (не
 * копирует SQL), просто конструирует их напрямую (`new Repo(db)`, тот же приём,
 * что `seed-catalog-drizzle-port.ts` применяет для домена `catalog`) — без
 * поднятия Nest DI, т.к. seed — standalone CLI. AGENTS.md §12: «прежде чем
 * создать — найди» — специального нового порта для аптек/остатков заводить не
 * пришлось, т.к. `PharmacyChainRepositoryPort`/`PharmacyAccountRepositoryPort`/
 * `PharmacyInventoryRepository` уже покрывают ровно то, что нужно.
 *
 * Генерация самих предложений остатков (детерминированные цена/срок/кол-во,
 * группировка аналогов) вынесена в `seed-pharmacy-offers.ts` (C1 `max-lines`).
 *
 * Идемпотентность:
 *   - `pharmacy_chains`/`pharmacies`: id фиксированы в `data/pharmacies.seed.json`,
 *     `save()` обоих репозиториев — `INSERT ... ON CONFLICT (id) DO UPDATE`.
 *     Повторный запуск не создаёт дублей; при уже существующей записи повторный
 *     проход доменного state machine (`draft→...→active`) НЕ выполняется (см.
 *     `ensureChainApproved`/`ensurePharmacyActive` — короткое замыкание по
 *     `findById`), чтобы не звать `assertTransitionAllowed` на уже-`active`
 *     сущности (это бросило бы `InvalidOnboardingTransitionError`).
 *   - `pharmacy_inventory`: `DrizzlePharmacyInventoryRepository.upsertMany` —
 *     `ON CONFLICT (pharmacy_id, medicine_id, COALESCE(batch_number,''), expires_at)
 *     DO UPDATE` (тот же уникальный индекс FEFO). Повторный запуск с теми же
 *     детерминированными строками просто перезаписывает те же значения.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PharmacyChain } from '@/modules/onboarding/domain/pharmacy-chain.entity.js'
import { PharmacyAccount } from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import type { PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import type { PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import type { PharmacyInventoryRepository } from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import { CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE } from '@/modules/onboarding/domain/pharmacy-account-entity.types.js'
import {
  buildOffersForMedicine,
  selectMedicinesForOffers,
  upsertOffersByPharmacy,
  type CatalogMedicineForOffers,
} from './seed-pharmacy-offers.js'

export type { CatalogMedicineForOffers } from './seed-pharmacy-offers.js'

const FILE_URL_PATH = fileURLToPath(import.meta.url)
const MODULE_DIR = dirname(FILE_URL_PATH)
const DATA_DIR = resolve(MODULE_DIR, 'data')

/** Уже существующая аптека (см. текст задачи) — включается в пул для остатков, если найдена. */
export const EXISTING_PHARMACY_ID = '0ee027ca-7616-4515-9c5f-aad289951dd0'

/** Фиксированный actor для доменных переходов approve/activate — только для аудита, seed не читает его обратно. */
const SEED_ACTOR = { id: '00000000-0000-4000-8000-0000000000aa' }

interface SeedChain {
  readonly id: string
  readonly legalEntityName: string
  readonly tinInn: string
  readonly directorFullName: string
  readonly contactPhone: string
  readonly legalAddress: string | null
  readonly isWhitelabelRequested: boolean
}

interface SeedPharmacy {
  readonly id: string
  readonly chainId: string
  readonly name: string
  readonly addressText: string
  readonly landmarkTj: string | null
  readonly latitude: number
  readonly longitude: number
  readonly phone: string
  readonly is24_7: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
  readonly licenseNumber: string
  readonly licenseExpiryDate: string
}

interface SeedPharmaciesData {
  readonly chains: readonly SeedChain[]
  readonly pharmacies: readonly SeedPharmacy[]
}

function readSeedData(): SeedPharmaciesData {
  return JSON.parse(readFileSync(join(DATA_DIR, 'pharmacies.seed.json'), 'utf8')) as SeedPharmaciesData
}

export interface SeedPharmaciesDeps {
  readonly chainRepo: PharmacyChainRepositoryPort
  readonly accountRepo: PharmacyAccountRepositoryPort
  readonly inventoryRepo: PharmacyInventoryRepository
  readonly listMedicinesWithSubstances: () => Promise<readonly CatalogMedicineForOffers[]>
}

export interface SeedPharmaciesResult {
  readonly chainsEnsured: number
  readonly pharmaciesEnsured: number
  readonly pharmacyPoolSize: number
  readonly medicinesCovered: number
  readonly offersUpserted: number
}

/** `draft → pending_review → approved` для `PharmacyChain`, если ещё не создана. */
async function ensureChainApproved(repo: PharmacyChainRepositoryPort, seed: SeedChain, now: Date): Promise<void> {
  const existing = await repo.findById(seed.id)
  if (existing !== null) {
    return
  }
  const chain = PharmacyChain.create({
    id: seed.id,
    name: seed.legalEntityName,
    legalEntityName: seed.legalEntityName,
    tinInn: seed.tinInn,
    directorFullName: seed.directorFullName,
    contactPhone: seed.contactPhone,
    legalAddress: seed.legalAddress,
    isWhitelabelRequested: seed.isWhitelabelRequested,
  })
    .submitForReview(now)
    .approve(SEED_ACTOR)
  await repo.save(chain)
}

/** `draft → pending_review → approved → active` для `PharmacyAccount`, если ещё не создана. */
async function ensurePharmacyActive(
  deps: Pick<SeedPharmaciesDeps, 'accountRepo' | 'chainRepo'>,
  seed: SeedPharmacy,
  now: Date,
): Promise<void> {
  const existing = await deps.accountRepo.findById(seed.id)
  if (existing !== null) {
    return
  }
  const chain = await deps.chainRepo.findById(seed.chainId)
  const parentChainStatus = chain?.status ?? 'approved'
  if (!CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE.has(parentChainStatus)) {
    throw new Error(`seed-pharmacies: parent chain ${seed.chainId} is not approved/active (status=${parentChainStatus})`)
  }
  const draft = PharmacyAccount.create({
    id: seed.id,
    chainId: seed.chainId,
    name: seed.name,
    addressText: seed.addressText,
    latitude: seed.latitude,
    longitude: seed.longitude,
    phone: seed.phone,
    licenseNumber: seed.licenseNumber,
    licenseExpiryDate: new Date(seed.licenseExpiryDate),
  })
  const withSchedule = draft.updateApplication({
    landmarkTj: seed.landmarkTj,
    is24_7: seed.is24_7,
    openingTime: seed.openingTime,
    closingTime: seed.closingTime,
  })
  const active = withSchedule
    .submitForReview(now)
    .approve(SEED_ACTOR)
    .activate(SEED_ACTOR, parentChainStatus)
  await deps.accountRepo.save(active)
}

async function ensurePharmaciesAndChains(deps: SeedPharmaciesDeps, data: SeedPharmaciesData, now: Date): Promise<void> {
  for (const chain of data.chains) {
    // eslint-disable-next-line no-await-in-loop -- сети независимы, но их всего 3; последовательный цикл проще для отладки seed.
    await ensureChainApproved(deps.chainRepo, chain, now)
  }
  for (const pharmacy of data.pharmacies) {
    // eslint-disable-next-line no-await-in-loop -- активация аптеки требует знать статус её сети (findById) — порядок важен, аптек всего 6.
    await ensurePharmacyActive(deps, pharmacy, now)
  }
}

async function resolvePharmacyPool(deps: SeedPharmaciesDeps, data: SeedPharmaciesData): Promise<readonly string[]> {
  const existingPharmacy = await deps.accountRepo.findById(EXISTING_PHARMACY_ID)
  return [...(existingPharmacy !== null ? [EXISTING_PHARMACY_ID] : []), ...data.pharmacies.map((p) => p.id)]
}

/**
 * Точка входа: аптеки/сети (идемпотентно, только если ещё не созданы) +
 * остатки (идемпотентный upsert по FEFO-ключу на каждый прогон).
 */
export async function runSeedPharmacies(deps: SeedPharmaciesDeps, now: Date = new Date()): Promise<SeedPharmaciesResult> {
  const data = readSeedData()
  await ensurePharmaciesAndChains(deps, data, now)
  const pharmacyPool = await resolvePharmacyPool(deps, data)

  const medicines = await deps.listMedicinesWithSubstances()
  const selected = selectMedicinesForOffers(medicines)
  const offers = selected.flatMap((med) => buildOffersForMedicine(med, pharmacyPool, now))
  const offersUpserted = await upsertOffersByPharmacy(deps.inventoryRepo, offers, now)

  return {
    chainsEnsured: data.chains.length,
    pharmaciesEnsured: data.pharmacies.length,
    pharmacyPoolSize: pharmacyPool.length,
    medicinesCovered: selected.length,
    offersUpserted,
  }
}
