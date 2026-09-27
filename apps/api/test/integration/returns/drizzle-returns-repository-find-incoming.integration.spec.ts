// DTJ-433 foundIssue: GET /api/v1/order-returns (список) на реальном Postgres — скоуп по роли,
// чужая аптека/сеть/тенант не видна (SRS-RET-011).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleReturnsRepository } from '@/modules/returns/infrastructure/repositories/drizzle-returns.repository.js'

const TEST_DATABASE_URL =
  process.env.RETURNS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
const DEFAULT_LIMIT = 20

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

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

describe.skipIf(!postgresAvailable)('DrizzleReturnsRepository.findIncoming — RBAC scope (DTJ-433)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repo: DrizzleReturnsRepository
  const cleanupIds = { orderReturns: [] as string[], orders: [] as string[], users: [] as string[], pharmacies: [] as string[], chains: [] as string[], tenants: [] as string[] }

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    repo = new DrizzleReturnsRepository(db)
  })

  afterAll(async () => {
    await pool.query('DELETE FROM order_returns WHERE id = ANY($1)', [cleanupIds.orderReturns]).catch(() => undefined)
    await pool.query('DELETE FROM orders WHERE id = ANY($1)', [cleanupIds.orders]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [cleanupIds.users]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [cleanupIds.pharmacies]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [cleanupIds.chains]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [cleanupIds.tenants]).catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  async function seedTenant(): Promise<string> {
    const id = randomUUID()
    await pool.query('INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)', [id, `dtj433-${id.slice(0, 8)}`])
    cleanupIds.tenants.push(id)
    return id
  }

  async function seedChain(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      "INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'DTJ-433 chain', 'DTJ-433 LLC', $2)",
      [id, randomUUID().slice(0, 20)],
    )
    cleanupIds.chains.push(id)
    return id
  }

  async function seedPharmacy(chainId: string | null): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone)
       VALUES ($1, $2, 'DTJ-433 pharmacy', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000004')`,
      [id, chainId],
    )
    cleanupIds.pharmacies.push(id)
    return id
  }

  async function seedUser(tenantId: string): Promise<string> {
    const id = randomUUID()
    await pool.query('INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, $3)', [id, tenantId, 'customer'])
    cleanupIds.users.push(id)
    return id
  }

  async function seedOrder(tenantId: string, pharmacyId: string, customerId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'picked_up', 'cash_courier', 100, 50, 150, 'Dushanbe, Rudaki 1', $5, $6)`,
      [id, `260927-${id.slice(0, 5)}`, customerId, pharmacyId, tenantId, randomUUID()],
    )
    cleanupIds.orders.push(id)
    return id
  }

  async function seedReturn(orderId: string, initiatedBy: string, status: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO order_returns (id, order_id, status, reason, initiated_by) VALUES ($1, $2, $3, 'defect', $4)`,
      [id, orderId, status, initiatedBy],
    )
    cleanupIds.orderReturns.push(id)
    return id
  }

  it('pharmacist видит только возвраты своей аптеки, чужая аптека — не видна', async () => {
    const tenantId = await seedTenant()
    const ownPharmacyId = await seedPharmacy(null)
    const otherPharmacyId = await seedPharmacy(null)
    const customerId = await seedUser(tenantId)
    const ownOrderId = await seedOrder(tenantId, ownPharmacyId, customerId)
    const otherOrderId = await seedOrder(tenantId, otherPharmacyId, customerId)
    const ownReturnId = await seedReturn(ownOrderId, customerId, 'return_in_transit')
    await seedReturn(otherOrderId, customerId, 'return_in_transit')

    const result = await repo.findIncoming({
      tenantId,
      pharmacyId: ownPharmacyId,
      chainId: null,
      statuses: ['return_in_transit', 'return_rejected'],
      cursor: null,
      limit: DEFAULT_LIMIT,
    })

    expect(result.items.map((item) => item.id)).toEqual([ownReturnId])
  })

  it('pharmacy_admin видит возвраты всех аптек своей сети, чужая сеть — не видна', async () => {
    const tenantId = await seedTenant()
    const ownChainId = await seedChain()
    const otherChainId = await seedChain()
    const pharmacyAId = await seedPharmacy(ownChainId)
    const pharmacyBId = await seedPharmacy(ownChainId)
    const otherChainPharmacyId = await seedPharmacy(otherChainId)
    const customerId = await seedUser(tenantId)
    const orderAId = await seedOrder(tenantId, pharmacyAId, customerId)
    const orderBId = await seedOrder(tenantId, pharmacyBId, customerId)
    const otherChainOrderId = await seedOrder(tenantId, otherChainPharmacyId, customerId)
    const returnAId = await seedReturn(orderAId, customerId, 'return_rejected')
    const returnBId = await seedReturn(orderBId, customerId, 'return_in_transit')
    await seedReturn(otherChainOrderId, customerId, 'return_in_transit')

    const result = await repo.findIncoming({
      tenantId,
      pharmacyId: null,
      chainId: ownChainId,
      statuses: ['return_in_transit', 'return_rejected'],
      cursor: null,
      limit: DEFAULT_LIMIT,
    })

    expect(new Set(result.items.map((item) => item.id))).toEqual(new Set([returnAId, returnBId]))
  })

  it('super_admin видит возвраты по всему тенанту; чужой тенант и терминальный статус исключены', async () => {
    const tenantId = await seedTenant()
    const otherTenantId = await seedTenant()
    const pharmacyId = await seedPharmacy(null)
    const otherTenantPharmacyId = await seedPharmacy(null)
    const customerId = await seedUser(tenantId)
    const otherTenantCustomerId = await seedUser(otherTenantId)
    const orderId = await seedOrder(tenantId, pharmacyId, customerId)
    const confirmedOrderId = await seedOrder(tenantId, pharmacyId, customerId)
    const otherTenantOrderId = await seedOrder(otherTenantId, otherTenantPharmacyId, otherTenantCustomerId)
    const incomingReturnId = await seedReturn(orderId, customerId, 'return_in_transit')
    await seedReturn(confirmedOrderId, customerId, 'return_confirmed')
    await seedReturn(otherTenantOrderId, otherTenantCustomerId, 'return_in_transit')

    const result = await repo.findIncoming({
      tenantId,
      pharmacyId: null,
      chainId: null,
      statuses: ['return_in_transit', 'return_rejected'],
      cursor: null,
      limit: DEFAULT_LIMIT,
    })

    expect(result.items.map((item) => item.id)).toEqual([incomingReturnId])
  })
})
