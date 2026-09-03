/**
 * Интеграционный тест `MockBankAutoPayJob` (EP-10, DTJ-238, тест-план тикета) — РЕАЛЬНЫЙ
 * BullMQ + РЕАЛЬНЫЙ Redis (не Testcontainers, D-EP09-14/31 — `describe.skipIf`, тот же приём,
 * что `health.integration.spec.ts`/`cart-abandoned-cleanup.job.integration.spec.ts`).
 *
 * Покрывает AC1/AC2 DTJ-238 end-to-end: `Queue.add(..., { delay })` (симулирует
 * `MockBankProvider`, apps/api) → реальный `Worker` (эта джоба) → `POST` на локальный
 * HTTP-тестовый сервер, подписанный HMAC — «Риски» ticket'а: обработчик `POST /api/v1/
 * payments/webhook` — DTJ-243, здесь заменён локальным сервером-заглушкой с ТОЙ ЖЕ сигнатурой
 * (заголовки/тело), переключить на реальный при интеграции обоих тикетов.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import IORedis, { type Redis } from 'ioredis'
import { Queue, Worker } from 'bullmq'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MockBankAutoPayJob } from './mock-bank-auto-pay.job.js'
import type { MockBankAutoPayJobData } from './mock-bank-auto-pay.types.js'

const TEST_REDIS_URL = process.env.WORKER_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const PROBE_TIMEOUT_MS = 500
const EPHEMERAL_PORT = 0
const WEBHOOK_SECRET = 'test-mock-bank-integration-secret'
const SHORT_DELAY_MS = 300
/** Запас сверх SHORT_DELAY_MS на ожидание вебхука (джиттер планировщика BullMQ). */
const WAIT_MARGIN_MS = 4_700
const TEST_TIMEOUT_MS = 15_000
/** ОБЯЗАН совпадать с QUEUE_NAMES.MOCK_BANK_AUTO_PAY (apps/worker/src/queues/queue.constants.ts). */
const QUEUE_NAME = 'mock-bank-auto-pay'

async function isRedisReachable(url: string): Promise<boolean> {
  const client = new IORedis(url, {
    lazyConnect: true,
    connectTimeout: PROBE_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  try {
    await client.connect()
    await client.ping()
    return true
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}

const testRedisAvailable = await isRedisReachable(TEST_REDIS_URL)

interface CapturedRequest {
  readonly headers: Record<string, string | string[] | undefined>
  readonly rawBody: Buffer
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

describe.skipIf(!testRedisAvailable)('MockBankAutoPayJob — integration (DTJ-238, real BullMQ + Redis)', () => {
  let connection: Redis
  let queue: Queue<MockBankAutoPayJobData>
  let worker: Worker<MockBankAutoPayJobData>
  let httpServer: Server
  let apiInternalUrl: string
  let capturedRequests: CapturedRequest[]

  beforeAll(async () => {
    connection = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
    capturedRequests = []
    httpServer = createServer((req, res) => {
      void readRequestBody(req).then((rawBody) => {
        capturedRequests.push({ headers: req.headers, rawBody })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => httpServer.listen(EPHEMERAL_PORT, '127.0.0.1', resolve))
    const address = httpServer.address()
    if (address === null || typeof address === 'string') {
      throw new Error('failed to obtain ephemeral HTTP server port')
    }
    apiInternalUrl = `http://127.0.0.1:${String(address.port)}`

    queue = new Queue<MockBankAutoPayJobData>(QUEUE_NAME, { connection })
    const job = new MockBankAutoPayJob()
    worker = new Worker<MockBankAutoPayJobData>(
      QUEUE_NAME,
      (bullJob) => job.process(bullJob, { apiInternalUrl, webhookSecret: WEBHOOK_SECRET }),
      { connection },
    )
    await worker.waitUntilReady()
  })

  afterAll(async () => {
    await worker.close()
    await queue.obliterate({ force: true }).catch(() => undefined)
    await queue.close()
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve()
      })
    })
    connection.disconnect()
  })

  it(
    'AC1: планирует задержанную джобу, реальный Worker отправляет подписанный POST после задержки',
    async () => {
      const jobData: MockBankAutoPayJobData = {
        bankEventId: 'evt-integration-1',
        providerRef: 'mock_inv_integration',
        type: 'payment_confirmed',
        amountDiram: '55000',
      }
      const enqueuedAt = Date.now()
      await queue.add('mock-bank-auto-pay', jobData, {
        delay: SHORT_DELAY_MS,
        removeOnComplete: true,
        removeOnFail: true,
      })

      await expect
        .poll(() => capturedRequests.length, { timeout: WAIT_MARGIN_MS, interval: 50 })
        .toBeGreaterThan(0)

      const elapsedMs = Date.now() - enqueuedAt
      expect(elapsedMs).toBeGreaterThanOrEqual(SHORT_DELAY_MS - 50)

      const captured = capturedRequests[0]
      expect(captured).toBeDefined()
      if (captured === undefined) return

      expect(captured.headers['x-payment-provider']).toBe('mock_bank')
      const signatureHeader = captured.headers['x-webhook-signature']
      expect(typeof signatureHeader).toBe('string')
      const expectedSignature = createHmac('sha256', WEBHOOK_SECRET).update(captured.rawBody).digest()
      const providedSignature = Buffer.from(signatureHeader as string, 'hex')
      expect(providedSignature.length).toBe(expectedSignature.length)
      expect(timingSafeEqual(providedSignature, expectedSignature)).toBe(true)

      const body = JSON.parse(captured.rawBody.toString('utf8')) as Record<string, unknown>
      expect(body.bankEventId).toBe('evt-integration-1')
      expect(body.providerRef).toBe('mock_inv_integration')
      expect(body.type).toBe('payment_confirmed')
      expect(body.amountDiram).toBe('55000')
    },
    TEST_TIMEOUT_MS,
  )
})
