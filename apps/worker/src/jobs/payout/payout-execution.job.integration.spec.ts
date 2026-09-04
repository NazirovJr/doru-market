/**
 * Интеграционный тест `PayoutExecutionJob` (DTJ-250, TC-PAY-008/TC-PAY-009,
 * `21-module-orders-payments-escrow.md`) — РЕАЛЬНЫЙ Postgres (скан И финальный `UPDATE`
 * выполняются РЕАЛЬНЫМ SQL через `PgPayoutExecutionAdapter`, не мок — см. JSDoc
 * `payout-execution.job.ts` про то, почему ОБЕ операции здесь, а не за HTTP-мостом) + локальный
 * HTTP-сервер-заглушка с ТОЙ ЖЕ сигнатурой, что `POST /api/v1/internal/payouts/transfer-batch`
 * (apps/api) — тот же приём, что `unpaid-order-timeout.job.integration.spec.ts` (DTJ-253).
 *
 * В ОТЛИЧИЕ от DTJ-253/254 (где реальная денежная мутация доказывается ОТДЕЛЬНЫМ api-side
 * файлом): здесь `due → paid` мутация ПОЛНОСТЬЮ доказывается ЭТИМ файлом, потому что она
 * ПОЛНОСТЬЮ происходит на стороне `apps/worker` — стенд-ин сервер лишь УПРАВЛЯЕТ тем, какие
 * `payoutScheduleId` считать «подтверждёнными» (играет роль `MockBankPayoutTransferProvider` со
 * стороны теста), а РЕАЛЬНЫЙ SQL `UPDATE payout_schedule SET status='paid'` — этого файла
 * ответственность. `TransferPayoutBatchUseCase`/`MockBankPayoutTransferProvider` (apps/api) —
 * покрыты СВОИМИ unit-тестами (без БД, эта половина моста не трогает `payout_schedule`).
 *
 * Сидируются `payout_schedule`-строки НАПРЯМУЮ SQL-ом в нужном статусе — тот же приём, что
 * `EscrowInvariantSpec` (DTJ-255), НЕ через несуществующую здесь `PayoutSchedulerJob` (DTJ-249,
 * параллельная ветка).
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PayoutExecutionDeps, PayoutExecutionJob } from './payout-execution.job.js'
import { PgPayoutExecutionAdapter } from './pg-payout-execution.adapter.js'
import { PAYOUT_EXECUTION_QUEUE } from './payout-execution.constants.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/2'
const PROBE_TIMEOUT_MS = 1_500
const INTERNAL_API_KEY = 'test-dtj250-integration-key'
const EPHEMERAL_PORT = 0
const BATCH_SIZE = 50
const GROSS_AMOUNT_DIRAM = 20_000n
const COMMISSION_DIRAM = 2_000n
const NET_AMOUNT_DIRAM = 18_000n
const HOLD_PERIOD_DAYS = 1

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

interface CapturedRequest {
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: { readonly payouts: readonly { readonly payoutScheduleId: string; readonly pharmacyMerchantRef: string; readonly amountDiram: string }[] }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

/** Заглушка `POST /api/v1/internal/payouts/transfer-batch` — та же форма ответа, что реальный
 * контроллер (`{ data: { batchRef, confirmedPayoutScheduleIds } }`), см. JSDoc файла. Управляет
 * "кто подтверждён" через `confirmFn` — играет роль `MockBankPayoutTransferProvider` со стороны
 * теста (см. JSDoc файла). */
function startStandInServer(
  captured: CapturedRequest[],
  confirmFn: (payoutScheduleId: string) => boolean = () => true,
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      void readBody(req).then((raw) => {
        const body = JSON.parse(raw.toString('utf8')) as CapturedRequest['body']
        captured.push({ headers: req.headers, body })
        const confirmedPayoutScheduleIds = body.payouts.filter((p) => confirmFn(p.payoutScheduleId)).map((p) => p.payoutScheduleId)
        const batchRef = confirmedPayoutScheduleIds.length > 0 ? `test_batch_${randomUUID()}` : null
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: { batchRef, confirmedPayoutScheduleIds } }))
      })
    })
    server.listen(EPHEMERAL_PORT, () => {
      resolve(server)
    })
  })
}

function serverUrl(server: Server): string {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('serverUrl: unexpected address')
  return `http://127.0.0.1:${String(address.port)}`
}

describe.skipIf(!postgresAvailable)('PayoutExecutionJob — integration (DTJ-250)', () => {
  let pool: Pool
  const tenantId = randomUUID()
  let customerId: string
  const createdOrderIds: string[] = []
  const createdPayoutScheduleIds: string[] = []
  const createdPharmacyIds: string[] = []
  const createdChainIds: string[] = []
  let orderNumberSeq = 0

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj250-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const id of createdPayoutScheduleIds.splice(0)) {
      await pool.query('DELETE FROM payout_schedule WHERE id = $1', [id])
    }
    for (const id of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM orders WHERE id = $1', [id])
    }
    for (const id of createdPharmacyIds.splice(0)) {
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [id])
    }
    for (const id of createdChainIds.splice(0)) {
      await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [id])
    }
  })

  async function seedPharmacyChain(payoutMerchantRef: string | null): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, payout_merchant_ref)
       VALUES ($1, 'DTJ-250 Test Chain', 'DTJ-250 Test LLC', $2, $3)`,
      [id, `tin-${id.slice(0, 8)}`, payoutMerchantRef],
    )
    createdChainIds.push(id)
    return id
  }

  async function seedPharmacy(chainId: string | null): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone)
       VALUES ($1, $2, 'DTJ-250 Test Pharmacy', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000003')`,
      [id, chainId],
    )
    createdPharmacyIds.push(id)
    return id
  }

  async function seedOrder(): Promise<string> {
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, 'delivered', 'alif_mobi', 20.00, 5.00, 25.00, 'Dushanbe, Rudaki 1', $4, $5)`,
      [orderId, `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`, customerId, tenantId, randomUUID()],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  async function seedPayoutSchedule(input: { pharmacyId: string; status: string; heldByDisputeId?: string }): Promise<string> {
    const orderId = await seedOrder()
    const id = randomUUID()
    await pool.query(
      `INSERT INTO payout_schedule (id, order_id, pharmacy_id, status, gross_amount_diram, commission_diram, net_amount_diram, hold_period_days, due_at, held_by_dispute_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '1 hour', $9)`,
      [id, orderId, input.pharmacyId, input.status, GROSS_AMOUNT_DIRAM, COMMISSION_DIRAM, NET_AMOUNT_DIRAM, HOLD_PERIOD_DAYS, input.heldByDisputeId ?? null],
    )
    createdPayoutScheduleIds.push(id)
    return id
  }

  async function fetchPayoutSchedule(id: string): Promise<{ status: string; paid_at: Date | null; payout_batch_ref: string | null }> {
    const result = await pool.query<{ status: string; paid_at: Date | null; payout_batch_ref: string | null }>(
      'SELECT status, paid_at, payout_batch_ref FROM payout_schedule WHERE id = $1',
      [id],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error(`payout_schedule row ${id} not found`)
    return row
  }

  function makeJob(apiInternalUrl: string): PayoutExecutionJob {
    const deps = new PayoutExecutionDeps(new PgPayoutExecutionAdapter(pool), BATCH_SIZE)
    return new PayoutExecutionJob(deps, apiInternalUrl, INTERNAL_API_KEY)
  }

  it('TC-PAY-008: 3 строки due, все подтверждены — все переходят в paid, paid_at заполнен, payout_batch_ref совпадает у всех (один батч)', async () => {
    const chainId = await seedPharmacyChain('merchant-ref-chain-1')
    const pharmacyId = await seedPharmacy(chainId)
    const idA = await seedPayoutSchedule({ pharmacyId, status: 'due' })
    const idB = await seedPayoutSchedule({ pharmacyId, status: 'due' })
    const idC = await seedPayoutSchedule({ pharmacyId, status: 'due' })
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const job = makeJob(serverUrl(server))

      const result = await job.runOnce()

      expect(result).toEqual({ scanned: 3, paid: 3, stillDue: 0 })
      const [rowA, rowB, rowC] = await Promise.all([fetchPayoutSchedule(idA), fetchPayoutSchedule(idB), fetchPayoutSchedule(idC)])
      for (const row of [rowA, rowB, rowC]) {
        expect(row.status).toBe('paid')
        expect(row.paid_at).not.toBeNull()
      }
      expect(rowA.payout_batch_ref).toBe(rowB.payout_batch_ref)
      expect(rowB.payout_batch_ref).toBe(rowC.payout_batch_ref)
      expect(rowA.payout_batch_ref).not.toBeNull()
    } finally {
      server.close()
    }
  })

  it('Критерий 2: частичный сбой (1 из 3 не подтверждена) — 2 строки paid, 1 строка ОСТАЁТСЯ due', async () => {
    const pharmacyId = await seedPharmacy(null)
    const idA = await seedPayoutSchedule({ pharmacyId, status: 'due' })
    const idB = await seedPayoutSchedule({ pharmacyId, status: 'due' })
    const idC = await seedPayoutSchedule({ pharmacyId, status: 'due' })
    const captured: CapturedRequest[] = []
    // idB симулируется неподтверждённой — тот же приём, что MockBankPayoutTransferProvider (apps/api).
    const server = await startStandInServer(captured, (payoutScheduleId) => payoutScheduleId !== idB)
    try {
      const job = makeJob(serverUrl(server))

      const result = await job.runOnce()

      expect(result).toEqual({ scanned: 3, paid: 2, stillDue: 1 })
      expect((await fetchPayoutSchedule(idA)).status).toBe('paid')
      expect((await fetchPayoutSchedule(idC)).status).toBe('paid')
      const rowB = await fetchPayoutSchedule(idB)
      expect(rowB.status).toBe('due')
      expect(rowB.paid_at).toBeNull()
      expect(rowB.payout_batch_ref).toBeNull()
    } finally {
      server.close()
    }
  })

  it('TC-PAY-009: строка disputed для одного из заказов НЕ включена в батч (не запрошена вовсе — WHERE status=\'due\' её уже исключает)', async () => {
    const pharmacyId = await seedPharmacy(null)
    const dueId = await seedPayoutSchedule({ pharmacyId, status: 'due' })
    const disputeId = randomUUID()
    const disputedId = await seedPayoutSchedule({ pharmacyId, status: 'disputed', heldByDisputeId: disputeId })
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const job = makeJob(serverUrl(server))

      const result = await job.runOnce()

      expect(result.scanned).toBe(1) // ТОЛЬКО due-строка
      const requestedIds = captured.flatMap((c) => c.body.payouts.map((p) => p.payoutScheduleId))
      expect(requestedIds).toEqual([dueId])
      expect(requestedIds).not.toContain(disputedId)
      const disputedRow = await fetchPayoutSchedule(disputedId)
      expect(disputedRow.status).toBe('disputed') // НЕ тронут
    } finally {
      server.close()
    }
  })

  it('AC4: ноль строк due (типичное R1-прод состояние) — джоба завершается без ошибки, HTTP-мост НЕ вызывается вовсе', async () => {
    const pharmacyId = await seedPharmacy(null)
    await seedPayoutSchedule({ pharmacyId, status: 'disputed', heldByDisputeId: randomUUID() })
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const job = makeJob(serverUrl(server))

      const result = await job.runOnce()

      expect(result).toEqual({ scanned: 0, paid: 0, stillDue: 0 })
      expect(captured).toHaveLength(0)
    } finally {
      server.close()
    }
  })

  it('pharmacyMerchantRef: аптека С сетью — реальный payout_merchant_ref; аптека БЕЗ сети (chain_id NULL) — синтетический fallback pharmacy_<id>', async () => {
    const chainId = await seedPharmacyChain('real-merchant-ref-xyz')
    const chainedPharmacyId = await seedPharmacy(chainId)
    const soloPharmacyId = await seedPharmacy(null)
    const chainedPayoutId = await seedPayoutSchedule({ pharmacyId: chainedPharmacyId, status: 'due' })
    const soloPayoutId = await seedPayoutSchedule({ pharmacyId: soloPharmacyId, status: 'due' })
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const job = makeJob(serverUrl(server))

      await job.runOnce()

      const items = captured[0]?.body.payouts ?? []
      const byId = new Map(items.map((p) => [p.payoutScheduleId, p.pharmacyMerchantRef]))
      expect(byId.get(chainedPayoutId)).toBe('real-merchant-ref-xyz')
      expect(byId.get(soloPayoutId)).toBe(`pharmacy_${soloPharmacyId}`)
    } finally {
      server.close()
    }
  })

  describe('реальный BullMQ (правило задания про jobId-баг DTJ-238 — не тестировать только заглушкой)', () => {
    let redis: IORedis
    let queue: Queue

    beforeAll(() => {
      redis = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
      queue = new Queue(PAYOUT_EXECUTION_QUEUE, { connection: redis })
    })

    afterAll(async () => {
      await queue.close()
      redis.disconnect()
    })

    it('upsertJobScheduler регистрирует реальный BullMQ repeat-scheduler без ошибок', async () => {
      try {
        await expect(
          queue.upsertJobScheduler('dtj250-test-scheduler', { pattern: '0 * * * *', tz: 'Asia/Dushanbe' }, { name: 'payout-execution-tick' }),
        ).resolves.toBeDefined()
        const schedulers = await queue.getJobSchedulers()
        expect(schedulers.some((s) => s.key === 'dtj250-test-scheduler')).toBe(true)
      } finally {
        await queue.removeJobScheduler('dtj250-test-scheduler')
      }
    })
  })
})
