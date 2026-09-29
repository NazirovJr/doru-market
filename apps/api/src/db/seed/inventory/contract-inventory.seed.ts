// Seed остатков pharmacy_inventory (DTJ-435): разные цены одного препарата в разных аптеках + кластер аналогов, референт дороже дженериков.
// Медикаменты каталога получают случайный UUID при вставке — остатки резолвят medicine_id по trade_name, а не хранят его литералом.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { SEED_ANALOG_CLUSTER, SEED_PHARMACIES } from '@dorutj/testing-kit'

const EXPIRES_AT_FAR = '2027-12-31'
const INVENTORY_ID_PREFIX = '30000000-0000-4000-8000-0000000000'
const BATCH_NUMBER_DIGITS = 4

function inventoryId(n: number): string {
  return `${INVENTORY_ID_PREFIX}${String(n).padStart(2, '0')}`
}

interface StockLine {
  readonly tradeName: string
  readonly pharmacyId: string
  readonly priceDiram: number
  readonly quantity: number
}

const OTHER_MEDICINES: readonly string[] = [
  'Ибупрофен 400 мг Фармстандарт',
  'Ибупрофен 400 мг STADA',
  'Амоксициллин 500 мг',
  'Амоксициллин 500 мг Хумофарм',
  'Цитрамон П Teva',
  'Цитрамон П Sandoz',
]

const CLUSTER_PHARMACY_PRICE_STEP_DIRAM = 5000
const CLUSTER_REFERENCE_BASE_PRICE_DIRAM = 120000
const CLUSTER_REFERENCE_QUANTITY = 50
const CLUSTER_GENERIC_BASE_PRICE_DIRAM = 70000
const CLUSTER_GENERIC_INDEX_STEP_DIRAM = 3000
const CLUSTER_GENERIC_QUANTITY = 60

function buildAnalogClusterStock(): readonly StockLine[] {
  const targets = [SEED_PHARMACIES.oneCCenter.id, SEED_PHARMACIES.excelCenter.id]
  const lines: StockLine[] = []
  for (const [idx, pharmacyId] of targets.entries()) {
    const priceStepDiram = idx * CLUSTER_PHARMACY_PRICE_STEP_DIRAM
    lines.push({
      tradeName: SEED_ANALOG_CLUSTER.referenceTradeName,
      pharmacyId,
      priceDiram: CLUSTER_REFERENCE_BASE_PRICE_DIRAM + priceStepDiram,
      quantity: CLUSTER_REFERENCE_QUANTITY,
    })
    for (const [genIdx, genericName] of SEED_ANALOG_CLUSTER.genericTradeNames.entries()) {
      lines.push({
        tradeName: genericName,
        pharmacyId,
        priceDiram: CLUSTER_GENERIC_BASE_PRICE_DIRAM + genIdx * CLUSTER_GENERIC_INDEX_STEP_DIRAM + priceStepDiram,
        quantity: CLUSTER_GENERIC_QUANTITY,
      })
    }
  }
  return lines
}

const OTHER_MEDICINE_BASE_PRICE_DIRAM = 80000
const OTHER_MEDICINE_INDEX_STEP_DIRAM = 15000
const OTHER_PHARMACY_PRICE_STEP_DIRAM = 2500
const OTHER_BASE_QUANTITY = 20
const OTHER_PHARMACY_QUANTITY_STEP = 5

function buildOtherStock(): readonly StockLine[] {
  const pharmacyIds = [
    SEED_PHARMACIES.oneCCenter.id,
    SEED_PHARMACIES.excelCenter.id,
    SEED_PHARMACIES.solo.id,
    SEED_PHARMACIES.whiteLabelCenter.id,
  ]
  const lines: StockLine[] = []
  for (const [medIdx, tradeName] of OTHER_MEDICINES.entries()) {
    const basePriceDiram = OTHER_MEDICINE_BASE_PRICE_DIRAM + medIdx * OTHER_MEDICINE_INDEX_STEP_DIRAM
    for (const [pharmIdx, pharmacyId] of pharmacyIds.entries()) {
      lines.push({
        tradeName,
        pharmacyId,
        priceDiram: basePriceDiram + pharmIdx * OTHER_PHARMACY_PRICE_STEP_DIRAM,
        quantity: OTHER_BASE_QUANTITY + pharmIdx * OTHER_PHARMACY_QUANTITY_STEP,
      })
    }
  }
  return lines
}

async function resolveMedicineIds(db: NodePgDatabase, tradeNames: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(tradeNames)]
  const rows = await db.execute<{ id: string; trade_name: string }>(
    sql`SELECT id, trade_name FROM medicines WHERE trade_name IN ${unique}`,
  )
  const map = new Map<string, string>()
  for (const row of rows.rows) {
    map.set(row.trade_name, row.id)
  }
  return map
}

export async function seedContractInventory(db: NodePgDatabase): Promise<void> {
  const lines = [...buildAnalogClusterStock(), ...buildOtherStock()]
  const medicineIdByName = await resolveMedicineIds(db, lines.map((l) => l.tradeName))

  await Promise.all(
    lines.map((line, idx) => {
      const medicineId = medicineIdByName.get(line.tradeName)
      if (medicineId === undefined) {
        // Каталожный seed обязан запускаться раньше и содержать эти позиции — недостижимо на практике.
        throw new Error(`[db:seed] medicine not found in catalog for inventory seed: "${line.tradeName}"`)
      }
      const n = idx + 1
      const batchNumber = `SEED-${String(n).padStart(BATCH_NUMBER_DIGITS, '0')}`
      return db.execute(sql`
        INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
        VALUES (${inventoryId(n)}, ${line.pharmacyId}, ${medicineId}, ${line.priceDiram}, ${line.quantity}, ${EXPIRES_AT_FAR}, ${batchNumber})
        ON CONFLICT (id) DO NOTHING;
      `)
    }),
  )
}
