// Seed остатков pharmacy_inventory (DTJ-435): разные цены одного препарата в разных аптеках + кластер аналогов, референт дороже дженериков.
// Медикаменты каталога получают случайный UUID при вставке — остатки резолвят medicine_id по trade_name, а не хранят его литералом.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { SEED_ANALOG_CLUSTER, SEED_PHARMACIES } from '@dorutj/testing-kit'

const EXPIRES_AT_FAR = '2027-12-31'
const INVENTORY_ID_PREFIX = '30000000-0000-4000-8000-0000000000'

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

function buildAnalogClusterStock(): readonly StockLine[] {
  const targets = [SEED_PHARMACIES.oneCCenter.id, SEED_PHARMACIES.excelCenter.id]
  const lines: StockLine[] = []
  for (const [idx, pharmacyId] of targets.entries()) {
    const priceStepDiram = idx * 5000
    lines.push({ tradeName: SEED_ANALOG_CLUSTER.referenceTradeName, pharmacyId, priceDiram: 120000 + priceStepDiram, quantity: 50 })
    for (const [genIdx, genericName] of SEED_ANALOG_CLUSTER.genericTradeNames.entries()) {
      lines.push({
        tradeName: genericName,
        pharmacyId,
        priceDiram: 70000 + genIdx * 3000 + priceStepDiram,
        quantity: 60,
      })
    }
  }
  return lines
}

function buildOtherStock(): readonly StockLine[] {
  const pharmacyIds = [
    SEED_PHARMACIES.oneCCenter.id,
    SEED_PHARMACIES.excelCenter.id,
    SEED_PHARMACIES.solo.id,
    SEED_PHARMACIES.whiteLabelCenter.id,
  ]
  const lines: StockLine[] = []
  for (const [medIdx, tradeName] of OTHER_MEDICINES.entries()) {
    const basePriceDiram = 80000 + medIdx * 15000
    for (const [pharmIdx, pharmacyId] of pharmacyIds.entries()) {
      lines.push({ tradeName, pharmacyId, priceDiram: basePriceDiram + pharmIdx * 2500, quantity: 20 + pharmIdx * 5 })
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
      const batchNumber = `SEED-${String(n).padStart(4, '0')}`
      return db.execute(sql`
        INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
        VALUES (${inventoryId(n)}, ${line.pharmacyId}, ${medicineId}, ${line.priceDiram}, ${line.quantity}, ${EXPIRES_AT_FAR}, ${batchNumber})
        ON CONFLICT (id) DO NOTHING;
      `)
    }),
  )
}
