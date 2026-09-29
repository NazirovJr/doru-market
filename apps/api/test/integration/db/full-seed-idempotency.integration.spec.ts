// Идемпотентность pnpm db:seed (DTJ-435, критерий 1): полный пайплайн дважды подряд не меняет количество строк.
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runSeedCatalog } from '@/db/seed/seed-catalog.run.js'
import { createDrizzleSeedCatalogPort } from '@/db/seed/seed-catalog-drizzle-port.js'
import { seedI18nOverridesCatalog } from '@/db/seed/i18n-overrides-catalog.seed.js'
import { seedRequiredFeatureFlags } from '@/db/seed/feature-flags.seed.js'
import { seedNotificationTemplates } from '@/db/seed/notification-templates/seed-notification-templates.js'
import { seedWhiteLabelTenantAndChains } from '@/db/seed/tenants/white-label.seed.js'
import { seedPharmacyNetwork } from '@/db/seed/pharmacies/pharmacy-network.seed.js'
import { seedContractUsers } from '@/db/seed/users/contract-users.seed.js'
import { seedContractInventory } from '@/db/seed/inventory/contract-inventory.seed.js'
import { seedOrdersAllStatuses } from '@/db/seed/orders/all-statuses.seed.js'

const TEST_DATABASE_URL =
  process.env.DB_SEED_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500

const SEEDED_TABLES = [
  'categories',
  'substances',
  'medicines',
  'medicine_substances',
  'i18n_overrides',
  'feature_flags',
  'notification_templates',
  'tenants',
  'tenant_settings',
  'pharmacy_chains',
  'pharmacies',
  'users',
  'couriers',
  'pharmacy_inventory',
  'orders',
  'order_items',
  'payment_operations',
  'escrow_ledger',
  'payout_schedule',
  'delivery_assignments',
  'order_returns',
  'support_tickets',
  'order_disputes',
] as const

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

async function runFullSeedOnce(): Promise<void> {
  const catalogPort = await createDrizzleSeedCatalogPort()
  try {
    await runSeedCatalog(catalogPort.port)
  } finally {
    await catalogPort.close()
  }

  const pool = new Pool({ connectionString: TEST_DATABASE_URL })
  try {
    const db = drizzle(pool)
    await seedI18nOverridesCatalog(db)
    await seedRequiredFeatureFlags(db)
    await seedNotificationTemplates(db)
    await seedWhiteLabelTenantAndChains(db)
    await seedPharmacyNetwork(db)
    await seedContractUsers(db)
    await seedContractInventory(db)
    await seedOrdersAllStatuses(db)
  } finally {
    await pool.end().catch(() => undefined)
  }
}

async function countRows(pool: Pool): Promise<Record<string, number>> {
  const entries = await Promise.all(
    SEEDED_TABLES.map(async (table) => {
      const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`)
      return [table, Number(result.rows[0]?.count ?? '0')] as const
    }),
  )
  return Object.fromEntries(entries)
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

describe.skipIf(!postgresAvailable)('pnpm db:seed — идемпотентность (DTJ-435)', () => {
  let probePool: Pool

  beforeAll(async () => {
    probePool = new Pool({ connectionString: TEST_DATABASE_URL })
    process.env.DATABASE_URL = TEST_DATABASE_URL
    await runFullSeedOnce()
  }, 120_000)

  afterAll(async () => {
    await probePool.end().catch(() => undefined)
  })

  it('второй запуск полного db:seed не меняет количество строк ни в одной затронутой таблице', async () => {
    const before = await countRows(probePool)
    await runFullSeedOnce()
    const after = await countRows(probePool)
    expect(after).toEqual(before)
  }, 120_000)
})
