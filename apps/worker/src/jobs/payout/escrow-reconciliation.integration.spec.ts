/**
 * Интеграционный тест `EscrowReconciliationJob` (DTJ-247) — РЕАЛЬНЫЙ Postgres (не мок), тот же
 * приём, что `cart-abandoned-cleanup.job.integration.spec.ts` (DTJ-224): прямой `Pool`,
 * `describe.skipIf`, без Testcontainers (D-EP09-14/31).
 *
 * Проверяет:
 *  1. TC-PAY-010 (буквально, `21-module-orders-payments-escrow.md`): `escrow_ledger`
 *     hold_created=10000/captured_to_pharmacy=9000/platform_fee_captured=800 (расхождение 200)
 *     → `support_tickets(category='payment_issue')` создан, `audit_log` содержит
 *     `discrepancyDiram=200`, метрика инкрементирована.
 *  2. TC-PAY-011 (буквально): расхождение уже зафиксировано (тикет открыт) — джоба прогоняется
 *     СНОВА, новый `support_ticket` НЕ создаётся, `audit_log` получает ВТОРУЮ строку.
 *  3. Сбалансированный заказ — джоба НЕ создаёт ничего, тест умеет ПАДАТЬ (искусственно внесённое
 *     расхождение реально обнаруживается — не просто «зеленеет на сходящихся данных»).
 *  4. Несколько заказов ОДНОВРЕМЕННО (сбалансированный + 2 разбалансированных) — обрабатываются
 *     независимо.
 *  5. Реальный BullMQ `upsertJobScheduler` (правило задания про jobId-баг DTJ-238: заглушка
 *     очереди не поймала бы `Custom Id cannot contain :` — здесь очередь настоящая).
 *
 * Уборка (правило 5 AGENTS.md): `afterEach` удаляет ТОЛЬКО строки, созданные ЭТИМ тестом.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EscrowLedgerImbalanceMetric } from './escrow-ledger-imbalance.metric.js'
import { EscrowReconciliationJob, EscrowReconciliationPorts } from './escrow-reconciliation.job.js'
import { PgEscrowReconciliationScannerAdapter } from './pg-escrow-reconciliation-scanner.adapter.js'
import { PgSupportTicketAdapter } from './pg-support-ticket.adapter.js'
import { PgAuditLogAdapter } from './pg-audit-log.adapter.js'
import { ESCROW_RECONCILIATION_QUEUE } from './escrow-reconciliation.constants.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/2'
const PROBE_TIMEOUT_MS = 1_500
const DEDUP_DAYS = 7

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

interface AuditLogRow {
  readonly metadata: { readonly discrepancyDiram: string; readonly repeatDetectionCount: number }
}

describe.skipIf(!postgresAvailable)('EscrowReconciliationJob — integration (DTJ-247)', () => {
  let pool: Pool
  let job: EscrowReconciliationJob
  let metric: EscrowLedgerImbalanceMetric
  const tenantId = randomUUID()
  let customerId: string
  const createdOrderIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    metric = new EscrowLedgerImbalanceMetric(false)
    const ports = new EscrowReconciliationPorts(
      new PgEscrowReconciliationScannerAdapter(pool),
      new PgSupportTicketAdapter(pool),
      new PgAuditLogAdapter(pool),
    )
    job = new EscrowReconciliationJob(ports, DEDUP_DAYS, metric)

    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj247-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM audit_log WHERE entity_id = $1', [orderId])
      await pool.query('DELETE FROM support_tickets WHERE order_id = $1', [orderId])
      await pool.query('DELETE FROM escrow_ledger WHERE order_id = $1', [orderId])
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    }
  })

  async function seedOrder(): Promise<string> {
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, payment_method, status, items_total_tjs, delivery_fee_tjs,
          total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, 'alif_mobi', 'delivered', 100.00, 0.00, 100.00, 'x', $4, gen_random_uuid())`,
      [orderId, `DTJ247-${orderId.slice(0, 8)}`, customerId, tenantId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  async function appendEntry(input: {
    orderId: string
    entryType: string
    direction: 'debit' | 'credit'
    amountDiram: bigint
  }): Promise<void> {
    await pool.query(
      `INSERT INTO escrow_ledger (order_id, entry_type, direction, amount_diram) VALUES ($1, $2, $3, $4)`,
      [input.orderId, input.entryType, input.direction, input.amountDiram],
    )
  }

  async function seedBalancedOrder(): Promise<string> {
    const orderId = await seedOrder()
    await appendEntry({ orderId, entryType: 'hold_created', direction: 'debit', amountDiram: 10_000n })
    await appendEntry({ orderId, entryType: 'platform_fee_captured', direction: 'credit', amountDiram: 800n })
    await appendEntry({ orderId, entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: 9_200n })
    return orderId
  }

  async function seedImbalancedOrder(): Promise<string> {
    const orderId = await seedOrder()
    await appendEntry({ orderId, entryType: 'hold_created', direction: 'debit', amountDiram: 10_000n })
    await appendEntry({ orderId, entryType: 'platform_fee_captured', direction: 'credit', amountDiram: 800n })
    await appendEntry({ orderId, entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: 9_000n }) // недостаёт 200
    return orderId
  }

  it('TC-PAY-010: расхождение 200 diram — support_ticket создан, audit_log содержит discrepancyDiram=200, метрика инкрементирована', async () => {
    const orderId = await seedImbalancedOrder()
    const before = metric.value

    const result = await job.runOnce()

    expect(result.newTickets).toBeGreaterThanOrEqual(1)
    expect(metric.value).toBe(before + 1)

    const tickets = await pool.query<{ category: string; channel: string; is_escrow_blocking: boolean; status: string }>(
      `SELECT category, channel, is_escrow_blocking, status FROM support_tickets WHERE order_id = $1`,
      [orderId],
    )
    expect(tickets.rows).toHaveLength(1)
    expect(tickets.rows[0]).toMatchObject({
      category: 'payment_issue',
      channel: 'system_auto',
      is_escrow_blocking: false,
      status: 'open',
    })

    const auditRows = await pool.query<AuditLogRow>(
      `SELECT metadata FROM audit_log WHERE entity_id = $1 AND category = 'ledger_adjustment'`,
      [orderId],
    )
    expect(auditRows.rows).toHaveLength(1)
    expect(auditRows.rows[0]?.metadata.discrepancyDiram).toBe('200')
  })

  it('TC-PAY-011: расхождение уже зафиксировано (тикет открыт) — джоба прогоняется снова, новый support_ticket НЕ создаётся, audit_log получает вторую строку', async () => {
    const orderId = await seedImbalancedOrder()
    await job.runOnce()

    const secondRun = await job.runOnce()

    expect(secondRun.dedupedTickets).toBeGreaterThanOrEqual(1)
    const tickets = await pool.query(`SELECT id FROM support_tickets WHERE order_id = $1`, [orderId])
    expect(tickets.rows).toHaveLength(1) // РОВНО один — не два

    const auditRows = await pool.query<AuditLogRow>(
      `SELECT metadata FROM audit_log WHERE entity_id = $1 AND category = 'ledger_adjustment' ORDER BY created_at ASC`,
      [orderId],
    )
    expect(auditRows.rows).toHaveLength(2) // ВТОРАЯ строка (append-only, не UPDATE)
    expect(auditRows.rows[0]?.metadata.repeatDetectionCount).toBe(1)
    expect(auditRows.rows[1]?.metadata.repeatDetectionCount).toBe(2)
  })

  it('сбалансированный заказ — ни support_ticket, ни audit_log не создаются, метрика не растёт (тест УМЕЕТ падать — см. соседний тест на расхождении)', async () => {
    const orderId = await seedBalancedOrder()
    const before = metric.value

    await job.runOnce()

    expect(metric.value).toBe(before)
    const tickets = await pool.query(`SELECT id FROM support_tickets WHERE order_id = $1`, [orderId])
    expect(tickets.rows).toHaveLength(0)
    const auditRows = await pool.query(`SELECT id FROM audit_log WHERE entity_id = $1`, [orderId])
    expect(auditRows.rows).toHaveLength(0)
  })

  it('несколько заказов одновременно — сбалансированный не трогается, оба разбалансированных получают тикеты независимо', async () => {
    const balancedId = await seedBalancedOrder()
    const imbalancedIdA = await seedImbalancedOrder()
    const imbalancedIdB = await seedImbalancedOrder()

    await job.runOnce()

    const balancedTickets = await pool.query(`SELECT id FROM support_tickets WHERE order_id = $1`, [balancedId])
    const ticketsA = await pool.query(`SELECT id FROM support_tickets WHERE order_id = $1`, [imbalancedIdA])
    const ticketsB = await pool.query(`SELECT id FROM support_tickets WHERE order_id = $1`, [imbalancedIdB])
    expect(balancedTickets.rows).toHaveLength(0)
    expect(ticketsA.rows).toHaveLength(1)
    expect(ticketsB.rows).toHaveLength(1)
  })

  it('джоба НЕ мутирует escrow_ledger/orders ни при каком результате (DoD) — записи escrow_ledger идентичны до/после', async () => {
    const orderId = await seedImbalancedOrder()
    const before = await pool.query('SELECT entry_type, direction, amount_diram FROM escrow_ledger WHERE order_id = $1 ORDER BY entry_type', [orderId])

    await job.runOnce()

    const after = await pool.query('SELECT entry_type, direction, amount_diram FROM escrow_ledger WHERE order_id = $1 ORDER BY entry_type', [orderId])
    expect(after.rows).toEqual(before.rows)
  })

  describe('реальный BullMQ (правило задания про jobId-баг DTJ-238 — не тестировать только заглушкой)', () => {
    let redis: IORedis
    let queue: Queue

    beforeAll(() => {
      redis = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
      queue = new Queue(ESCROW_RECONCILIATION_QUEUE, { connection: redis })
    })

    afterAll(async () => {
      await queue.close()
      redis.disconnect()
    })

    it('upsertJobScheduler регистрирует реальный BullMQ repeat-scheduler без ошибок', async () => {
      try {
        await expect(
          queue.upsertJobScheduler('dtj247-test-scheduler', { pattern: '0 3 * * *', tz: 'Asia/Dushanbe' }, { name: 'escrow-reconciliation-tick' }),
        ).resolves.toBeDefined()
        const schedulers = await queue.getJobSchedulers()
        // `.key` (не `.id`) — реальная форма BullMQ 6.x `getJobSchedulers()`, проверено живым
        // прогоном (правило задания про jobId-баг DTJ-238 — настоящая очередь ловит расхождение
        // формы ответа, которое заглушка `{ add: () => ... }` никогда бы не поймала).
        expect(schedulers.some((s) => s.key === 'dtj247-test-scheduler')).toBe(true)
      } finally {
        await queue.removeJobScheduler('dtj247-test-scheduler')
      }
    })
  })
})
