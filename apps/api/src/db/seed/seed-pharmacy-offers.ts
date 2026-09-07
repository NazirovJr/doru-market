/**
 * Детерминированная генерация предложений остатков для демо-стенда (см.
 * `seed-pharmacies.run.ts` для контекста и обоснования подхода). Вынесено в
 * отдельный файл ради C1 `max-lines-per-function`/`max-lines` — чистые функции,
 * ноль I/O, легко unit-тестировать отдельно от Drizzle-репозиториев.
 */
import { InventoryBatchUpsertRow } from '@/modules/inventory/domain/value-objects/inventory-batch-upsert-row.vo.js'
import type { PharmacyInventoryRepository } from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'

/** Медикамент каталога с составом (для группировки аналогов по substanceId). */
export interface CatalogMedicineForOffers {
  readonly id: string
  readonly tradeName: string
  readonly substanceIds: readonly string[]
}

const OFFER_COUNT_MIN = 3
const OFFER_COUNT_MAX = 6
const COVERAGE_TARGET = 90
const ANALOG_MIN_GROUP_SIZE = 2
/** Множители цены (доля от базовой), возрастающие — даёт разброс ~17-43% между min/max предложением. */
const PRICE_MULTIPLIER_1 = 0.85
const PRICE_MULTIPLIER_2 = 0.92
const PRICE_MULTIPLIER_3 = 1.0
const PRICE_MULTIPLIER_4 = 1.08
const PRICE_MULTIPLIER_5 = 1.15
const PRICE_MULTIPLIER_6 = 1.22
const PRICE_MULTIPLIERS = [
  PRICE_MULTIPLIER_1,
  PRICE_MULTIPLIER_2,
  PRICE_MULTIPLIER_3,
  PRICE_MULTIPLIER_4,
  PRICE_MULTIPLIER_5,
  PRICE_MULTIPLIER_6,
] as const
const BASE_PRICE_MIN_DIRAM = 1500
const BASE_PRICE_MAX_DIRAM = 25000
const QUANTITY_MIN = 5
const QUANTITY_MAX = 300
const EXPIRY_DAYS_MIN = 45
const EXPIRY_DAYS_MAX = 540
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const MULBERRY32_INCREMENT = 0x6d2b79f5
const MULBERRY32_SHIFT_15 = 15
const MULBERRY32_SHIFT_7 = 7
const MULBERRY32_MIX_1 = 61
const MULBERRY32_SHIFT_14 = 14
const UINT32_SPACE = 4294967296
const BATCH_HASH_RADIX = 36
const BATCH_SUFFIX_LENGTH = 8

/** FNV-1a, 32-бит. Детерминированный хэш строки → uint32 (не криптографический, для seed-разброса). */
export function hashString(value: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/** mulberry32 — маленький детерминированный PRNG, засеваемый `hashString`. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + MULBERRY32_INCREMENT) | 0
    let t = Math.imul(a ^ (a >>> MULBERRY32_SHIFT_15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> MULBERRY32_SHIFT_7), MULBERRY32_MIX_1 | t)) ^ t
    return ((t ^ (t >>> MULBERRY32_SHIFT_14)) >>> 0) / UINT32_SPACE
  }
}

/** Детерминированная перестановка Фишера-Йетса, засеянная строкой. */
function seededShuffle<T>(items: readonly T[], seedText: string): T[] {
  const rng = mulberry32(hashString(seedText))
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j] as T
    out[j] = tmp as T
  }
  return out
}

/** Медикаменты, участвующие хотя бы в одной аналоговой группе (⩾2 медикамента на substanceId). */
function collectAnalogGroupMedicineIds(medicines: readonly CatalogMedicineForOffers[]): ReadonlySet<string> {
  const bySubstance = new Map<string, CatalogMedicineForOffers[]>()
  for (const med of medicines) {
    for (const substanceId of med.substanceIds) {
      const bucket = bySubstance.get(substanceId) ?? []
      bucket.push(med)
      bySubstance.set(substanceId, bucket)
    }
  }
  const priority = new Set<string>()
  for (const bucket of bySubstance.values()) {
    if (bucket.length >= ANALOG_MIN_GROUP_SIZE) {
      for (const med of bucket) priority.add(med.id)
    }
  }
  return priority
}

/** Выбор набора медикаментов для покрытия: сперва аналоговые группы, потом добор до COVERAGE_TARGET. */
export function selectMedicinesForOffers(
  medicines: readonly CatalogMedicineForOffers[],
): readonly CatalogMedicineForOffers[] {
  const sorted = [...medicines].sort((a, b) => a.tradeName.localeCompare(b.tradeName) || a.id.localeCompare(b.id))
  const priority = collectAnalogGroupMedicineIds(medicines)
  const selected: CatalogMedicineForOffers[] = []
  const seen = new Set<string>()
  const pools = [sorted.filter((m) => priority.has(m.id)), sorted.filter((m) => !priority.has(m.id))]
  for (const pool of pools) {
    for (const med of pool) {
      if (selected.length >= COVERAGE_TARGET) break
      if (seen.has(med.id)) continue
      selected.push(med)
      seen.add(med.id)
    }
  }
  return selected
}

function offerCountFor(medicineId: string): number {
  const span = OFFER_COUNT_MAX - OFFER_COUNT_MIN + 1
  return OFFER_COUNT_MIN + (hashString(`offers:${medicineId}`) % span)
}

function basePriceDiramFor(medicineId: string): number {
  const span = BASE_PRICE_MAX_DIRAM - BASE_PRICE_MIN_DIRAM
  return BASE_PRICE_MIN_DIRAM + (hashString(`price:${medicineId}`) % span)
}

function quantityFor(medicineId: string, pharmacyId: string): number {
  const span = QUANTITY_MAX - QUANTITY_MIN + 1
  return QUANTITY_MIN + (hashString(`qty:${medicineId}:${pharmacyId}`) % span)
}

function expiresAtIsoFor(medicineId: string, pharmacyId: string, now: Date): string {
  const span = EXPIRY_DAYS_MAX - EXPIRY_DAYS_MIN + 1
  const days = EXPIRY_DAYS_MIN + (hashString(`expiry:${medicineId}:${pharmacyId}`) % span)
  return new Date(now.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10)
}

export interface PharmacyOffer {
  readonly pharmacyId: string
  readonly medicineId: string
  readonly price: number
  readonly quantity: number
  readonly expiresAtIso: string
  readonly batchNumber: string
}

/** Строит предложения для одного медикамента: k аптек из пула, возрастающие множители цены. */
export function buildOffersForMedicine(
  medicine: CatalogMedicineForOffers,
  pharmacyPool: readonly string[],
  now: Date,
): readonly PharmacyOffer[] {
  const k = Math.min(offerCountFor(medicine.id), pharmacyPool.length)
  if (k < 1) return []
  const shuffledPharmacies = seededShuffle(pharmacyPool, `pharmacy-pick:${medicine.id}`).slice(0, k)
  const tableLen = PRICE_MULTIPLIERS.length
  const startMax = Math.max(1, tableLen - k + 1)
  const start = hashString(`mult-start:${medicine.id}`) % startMax
  const multipliers = PRICE_MULTIPLIERS.slice(start, start + k)
  const basePrice = basePriceDiramFor(medicine.id)
  return shuffledPharmacies.map((pharmacyId, idx) => {
    const multiplier = multipliers[idx] ?? 1
    const price = Math.max(1, Math.round(basePrice * multiplier))
    return {
      pharmacyId,
      medicineId: medicine.id,
      price,
      quantity: quantityFor(medicine.id, pharmacyId),
      expiresAtIso: expiresAtIsoFor(medicine.id, pharmacyId, now),
      batchNumber: `SEED-${hashString(`${medicine.id}:${pharmacyId}`).toString(BATCH_HASH_RADIX).toUpperCase().slice(0, BATCH_SUFFIX_LENGTH)}`,
    }
  })
}

function groupByPharmacy(offers: readonly PharmacyOffer[]): ReadonlyMap<string, PharmacyOffer[]> {
  const byPharmacy = new Map<string, PharmacyOffer[]>()
  for (const offer of offers) {
    const bucket = byPharmacy.get(offer.pharmacyId) ?? []
    bucket.push(offer)
    byPharmacy.set(offer.pharmacyId, bucket)
  }
  return byPharmacy
}

function toUpsertRow(offer: PharmacyOffer, now: Date): InventoryBatchUpsertRow {
  const result = InventoryBatchUpsertRow.create(
    {
      medicineId: offer.medicineId,
      barcode: null,
      price: offer.price,
      quantity: offer.quantity,
      expiresAt: offer.expiresAtIso,
      batchNumber: offer.batchNumber,
    },
    now,
  )
  if (!result.ok) {
    throw new Error(`seed-pharmacies: invalid offer for ${offer.medicineId}/${offer.pharmacyId}: ${result.error.message}`)
  }
  return result.value
}

export async function upsertOffersByPharmacy(
  inventoryRepo: PharmacyInventoryRepository,
  offers: readonly PharmacyOffer[],
  now: Date,
): Promise<number> {
  const byPharmacy = groupByPharmacy(offers)
  let total = 0
  for (const [pharmacyId, bucket] of byPharmacy) {
    const rows = bucket.map((offer) => toUpsertRow(offer, now))
    // eslint-disable-next-line no-await-in-loop -- аптеки независимы, но upsertMany уже пакетный per-аптека SQL; последовательный цикл по аптекам (7 шт.) проще для отладки seed, чем Promise.all с общим пулом соединений.
    const upsertResult = await inventoryRepo.upsertMany({ pharmacyId, rows })
    total += upsertResult.acceptedCount
  }
  return total
}
