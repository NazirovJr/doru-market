// Seed ≥12 аптек (DTJ-435, SRS-NFR-031): 4 из контракта SEED_PHARMACIES + доп. аптеки тех же сетей. Требует, чтобы pharmacy_chains уже были вставлены (white-label.seed.ts).
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { SEED_CHAINS, SEED_PHARMACIES } from '@dorutj/testing-kit'

interface PharmacySeed {
  readonly id: string
  readonly chainId: string | null
  readonly name: string
  readonly addressText: string
  readonly latitude: string
  readonly longitude: string
  readonly phone: string
  readonly is24_7: boolean
}

const EXTRA_PHARMACY_ID_PREFIX = '10000000-0000-4000-8000-00000000d0'
const EXTRA_PHARMACY_ID_START = 5

function extraId(idx: number): string {
  return `${EXTRA_PHARMACY_ID_PREFIX}${String(EXTRA_PHARMACY_ID_START + idx).padStart(2, '0')}`
}

const CONTRACT_PHARMACIES: readonly PharmacySeed[] = [
  { id: SEED_PHARMACIES.oneCCenter.id, chainId: SEED_CHAINS.oneC.id, name: 'Сино Фарм — Центр', addressText: 'г. Душанбе, пр. Рудаки, 40', latitude: '38.57270000', longitude: '68.78700000', phone: '+992370010001', is24_7: true },
  { id: SEED_PHARMACIES.excelCenter.id, chainId: SEED_CHAINS.excel.id, name: 'Ватан Дору — Центр', addressText: 'г. Душанбе, ул. Бехзод, 15', latitude: '38.55900000', longitude: '68.77400000', phone: '+992370010002', is24_7: false },
  { id: SEED_PHARMACIES.solo.id, chainId: null, name: 'Аптека Сомон (соло)', addressText: 'г. Душанбе, ул. Сомони, 60', latitude: '38.58200000', longitude: '68.79600000', phone: '+992370010003', is24_7: false },
  { id: SEED_PHARMACIES.whiteLabelCenter.id, chainId: SEED_CHAINS.whiteLabel.id, name: 'Sifat Pharmacy — Центр', addressText: 'г. Душанбе, ул. Айни, 32', latitude: '38.56100000', longitude: '68.78100000', phone: '+992370010004', is24_7: true },
]

type ExtraPharmacySeed = Omit<PharmacySeed, 'id'>

// --- Доп. аптеки тех же сетей (для реалистичной сети точек, ≥12 всего) ---
const EXTRA_PHARMACIES: readonly ExtraPharmacySeed[] = [
  { chainId: SEED_CHAINS.oneC.id, name: 'Сино Фарм — Шохмансур', addressText: 'г. Душанбе, ул. Шевченко, 10', latitude: '38.56500000', longitude: '68.80500000', phone: '+992370010005', is24_7: false },
  { chainId: SEED_CHAINS.oneC.id, name: 'Сино Фарм — Исмоили Сомони', addressText: 'г. Душанбе, пр. Исмоили Сомони, 5', latitude: '38.58700000', longitude: '68.76900000', phone: '+992370010006', is24_7: false },
  { chainId: SEED_CHAINS.oneC.id, name: 'Сино Фарм — Вокзал', addressText: 'г. Душанбе, привокзальная пл., 2', latitude: '38.55300000', longitude: '68.82000000', phone: '+992370010007', is24_7: true },
  { chainId: SEED_CHAINS.excel.id, name: 'Ватан Дору — Зарафшон', addressText: 'г. Душанбе, ул. Зарафшон, 22', latitude: '38.59400000', longitude: '68.75600000', phone: '+992370010008', is24_7: false },
  { chainId: SEED_CHAINS.excel.id, name: 'Ватан Дору — Гипрозем', addressText: 'г. Душанбе, ул. Гиссарская, 8', latitude: '38.57900000', longitude: '68.83200000', phone: '+992370010009', is24_7: false },
  { chainId: SEED_CHAINS.excel.id, name: 'Ватан Дору — South Gate', addressText: 'г. Душанбе, ул. Дружбы Народов, 44', latitude: '38.55100000', longitude: '68.79900000', phone: '+992370010010', is24_7: false },
  { chainId: SEED_CHAINS.manual.id, name: 'Тибби Дорухона — №1', addressText: 'г. Душанбе, ул. Пушкина, 18', latitude: '38.58000000', longitude: '68.78000000', phone: '+992370010011', is24_7: false },
  { chainId: SEED_CHAINS.manual.id, name: 'Тибби Дорухона — №2', addressText: 'г. Душанбе, ул. Носира Махмуда, 3', latitude: '38.56800000', longitude: '68.81400000', phone: '+992370010012', is24_7: false },
  { chainId: SEED_CHAINS.whiteLabel.id, name: 'Sifat Pharmacy — Восток', addressText: 'г. Душанбе, ул. Мирзо Турсунзаде, 7', latitude: '38.59900000', longitude: '68.80700000', phone: '+992370010013', is24_7: false },
]

const PHARMACIES: readonly PharmacySeed[] = [
  ...CONTRACT_PHARMACIES,
  ...EXTRA_PHARMACIES.map((p, idx) => ({ ...p, id: extraId(idx) })),
]

export async function seedPharmacyNetwork(db: NodePgDatabase): Promise<void> {
  await Promise.all(
    PHARMACIES.map((pharmacy) =>
      db.execute(sql`
        INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, is_24_7, status)
        VALUES (${pharmacy.id}, ${pharmacy.chainId}, ${pharmacy.name}, ${pharmacy.addressText}, ${pharmacy.latitude}, ${pharmacy.longitude}, ${pharmacy.phone}, ${pharmacy.is24_7}, 'active')
        ON CONFLICT (id) DO NOTHING;
      `),
    ),
  )
}
