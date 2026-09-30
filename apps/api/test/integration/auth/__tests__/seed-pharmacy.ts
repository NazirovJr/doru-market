import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { pharmacyChains } from '@/db/schema/pharmacy-chains.js'

/** Создаёт сеть (если её ещё нет) и аптеку в ней; возвращает id аптеки. */
export async function seedPharmacyInChain(app: INestApplication, chainId: string): Promise<string> {
  const db = app.get<DrizzleDb>(DRIZZLE_DB)
  await db
    .insert(pharmacyChains)
    .values({ id: chainId, name: `Test Chain ${chainId}`, legalEntityName: 'Test LLC', tinInn: randomUUID().replace(/-/g, '').slice(0, 20) })
    .onConflictDoNothing()
  const id = randomUUID()
  await db.insert(pharmacies).values({
    id,
    chainId,
    name: 'Staff scope test pharmacy',
    addressText: 'Dushanbe, test str. 1',
    latitude: '38.5598',
    longitude: '68.7870',
    phone: '+992000000000',
  })
  return id
}
