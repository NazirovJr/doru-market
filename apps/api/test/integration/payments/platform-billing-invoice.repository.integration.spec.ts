/**
 * Интеграционный тест `PlatformBillingInvoiceRepository`/`DrizzlePlatformBillingInvoiceRepository`
 * (EP-10, DTJ-251) — РЕАЛЬНЫЙ Postgres, тот же лёгкий приём подключения (`drizzle(pool)`, без
 * полного `createTestApp()`), что `escrow-ledger.repository.integration.spec.ts` (DTJ-240,
 * ближайший прецедент этого каталога для репозитория без активного use case-потребителя).
 *
 * Не дублирует `cash-commission-aggregation.job.integration.spec.ts` (apps/worker) — та
 * проверяет РАЗДЕЛЬНЫЙ raw-SQL адаптер джобы (см. JSDoc порта `platform-billing-invoice-
 * repository.port.ts` про независимые пути доступа к одной таблице из двух процессов). Здесь —
 * round-trip именно этого Drizzle-репозитория: upsert аккумулирует subtotal, findDraftForPeriod
 * видит ТОЛЬКО draft, issue переводит draft→issued и НЕ трогает уже issued повторным вызовом.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzlePlatformBillingInvoiceRepository } from '@/modules/payments/infrastructure/repositories/platform-billing-invoice.repository.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const MS_PER_DAY = 24 * 60 * 60 * 1000

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

describe.skipIf(!postgresAvailable)('PlatformBillingInvoiceRepository — integration (DTJ-251)', () => {
  let pool: Pool
  let repository: DrizzlePlatformBillingInvoiceRepository
  let chainId: string
  const createdInvoiceIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    repository = new DrizzlePlatformBillingInvoiceRepository(drizzle(pool))

    chainId = randomUUID()
    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, $2, $2, $3)`, [
      chainId,
      `DTJ-251 Test Chain ${chainId.slice(0, 8)}`,
      `TIN-${chainId.slice(0, 12)}`,
    ])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const id of createdInvoiceIds.splice(0)) {
      await pool.query('DELETE FROM platform_billing_invoices WHERE id = $1', [id]).catch(() => undefined)
    }
  })

  function period(offsetWeeks = 0): { periodStart: Date; periodEnd: Date } {
    const periodStart = new Date(Date.UTC(2026, 0, 5 + offsetWeeks * 7)) // понедельник, произвольная неделя теста
    return { periodStart, periodEnd: new Date(periodStart.getTime() + 7 * MS_PER_DAY) }
  }

  async function trackCreatedInvoiceId(): Promise<void> {
    const result = await pool.query<{ id: string }>('SELECT id FROM platform_billing_invoices WHERE chain_id = $1', [chainId])
    for (const row of result.rows) {
      if (!createdInvoiceIds.includes(row.id)) createdInvoiceIds.push(row.id)
    }
  }

  it('upsertDraft: строки нет → создаёт draft; повторный вызов того же периода → аккумулирует subtotal/total, НЕ создаёт вторую строку', async () => {
    const { periodStart, periodEnd } = period(1)

    await repository.upsertDraft({ chainId, periodStart, periodEnd, additionalSubtotalDiram: 1_000n })
    await repository.upsertDraft({ chainId, periodStart, periodEnd, additionalSubtotalDiram: 500n })
    await trackCreatedInvoiceId()

    const rows = await pool.query<{ subtotal_diram: string; total_diram: string; vat_diram: string }>(
      `SELECT subtotal_diram, total_diram, vat_diram FROM platform_billing_invoices WHERE chain_id = $1 AND period_start = $2`,
      [chainId, periodStart],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ subtotal_diram: '1500', total_diram: '1500', vat_diram: '0' })
  })

  it('findDraftForPeriod: видит draft, возвращает null для периода без строки', async () => {
    const { periodStart, periodEnd } = period(2)
    await repository.upsertDraft({ chainId, periodStart, periodEnd, additionalSubtotalDiram: 777n })
    await trackCreatedInvoiceId()

    const found = await repository.findDraftForPeriod(chainId, periodStart)
    const notFound = await repository.findDraftForPeriod(chainId, period(3).periodStart)

    expect(found).toMatchObject({ chainId, status: 'draft', subtotalDiram: 777n })
    expect(notFound).toBeNull()
  })

  it('issue: draft → issued с переданными vat/total/dueAt; findDraftForPeriod после issue возвращает null (уже не draft)', async () => {
    const { periodStart, periodEnd } = period(4)
    await repository.upsertDraft({ chainId, periodStart, periodEnd, additionalSubtotalDiram: 100_000n })
    await trackCreatedInvoiceId()
    const draft = await repository.findDraftForPeriod(chainId, periodStart)
    if (draft === null) throw new Error('setup: draft not found')
    const issuedAt = new Date('2026-01-12T23:50:00Z')
    const dueAt = new Date(issuedAt.getTime() + 7 * MS_PER_DAY)

    await repository.issue({ invoiceId: draft.id, issuedAt, dueAt, vatDiram: 14_000n, totalDiram: 114_000n })

    const rows = await pool.query<{ status: string; vat_diram: string; total_diram: string }>(
      'SELECT status, vat_diram, total_diram FROM platform_billing_invoices WHERE id = $1',
      [draft.id],
    )
    expect(rows.rows[0]).toMatchObject({ status: 'issued', vat_diram: '14000', total_diram: '114000' })
    expect(await repository.findDraftForPeriod(chainId, periodStart)).toBeNull()
  })

  it('issue: повторный вызов на уже issued — no-op, не бросает, значения не меняются', async () => {
    const { periodStart, periodEnd } = period(5)
    await repository.upsertDraft({ chainId, periodStart, periodEnd, additionalSubtotalDiram: 50_000n })
    await trackCreatedInvoiceId()
    const draft = await repository.findDraftForPeriod(chainId, periodStart)
    if (draft === null) throw new Error('setup: draft not found')
    await repository.issue({ invoiceId: draft.id, issuedAt: new Date(), dueAt: new Date(), vatDiram: 7_000n, totalDiram: 57_000n })

    await expect(
      repository.issue({ invoiceId: draft.id, issuedAt: new Date(), dueAt: new Date(), vatDiram: 999n, totalDiram: 999n }),
    ).resolves.toBeUndefined()

    const rows = await pool.query<{ vat_diram: string }>('SELECT vat_diram FROM platform_billing_invoices WHERE id = $1', [draft.id])
    expect(rows.rows[0]?.vat_diram).toBe('7000') // не перезаписано вторым вызовом
  })
})
