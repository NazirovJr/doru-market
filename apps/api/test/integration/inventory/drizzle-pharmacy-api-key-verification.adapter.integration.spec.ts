/**
 * Интеграционный тест `DrizzlePharmacyApiKeyVerificationAdapter` (EP-05,
 * DTJ-156, D-11, волна 5 блок C) — РЕАЛЬНЫЙ Postgres + РЕАЛЬНЫЙ Redis, не
 * фейк (прямое указание CTO, `docs/07-WAVE4-HANDOFF.md` §3.2/«Чего не
 * делать»: интеграционный тест обязан бить в настоящую инфраструктуру).
 *
 * Проверяет весь боевой путь D-11 (SRS-API-033), которого до волны 5 не
 * существовало вообще (`PHARMACY_API_KEY_VERIFICATION` был на
 * `InMemoryPharmacyApiKeyVerificationAdapter` с plain-text сравнением
 * секрета):
 *   1. Валидный `argon2`-хеш + корректная HMAC-подпись — успех.
 *   2. Неверный секрет — `PharmacyApiKeyInvalidError`.
 *   3. Неактивный ключ (`is_active=false`) — `PharmacyApiKeyInvalidError`
 *      (эквивалент "revoked", см. ГЭП схемы в JSDoc адаптера).
 *   4. Повтор `nonce` — РЕАЛЬНЫЙ Redis `SET NX EX` ловит replay
 *      (`PharmacyRequestReplayedError`), не `Map` в памяти.
 *   5. Просроченный `timestamp` — `PharmacyTimestampOutOfWindowError`.
 *   6. Неверная подпись — `PharmacySignatureInvalidError`.
 *   7. Ключ, скоупнутый на сеть (`chain_id`, `pharmacy_id=NULL`) —
 *      отклоняется (ГЭП №3, см. JSDoc адаптера) — не возвращает
 *      `pharmacyId=null`/мусор.
 *
 * **Окружение.** БД/Redis — `INVENTORY_TEST_DATABASE_URL`/`INVENTORY_TEST_REDIS_URL`
 * (fallback: `DATABASE_URL`/`REDIS_URL`, дефолт совпадает с
 * `vitest.integration.config.ts`). Недоступная инфраструктура — честный
 * `describe.skipIf` (Ж13), не «зелёный по умолчанию».
 */
import { randomUUID, createHash, createHmac } from 'node:crypto'
import * as argon2 from 'argon2'
import { Pool } from 'pg'
import Redis from 'ioredis'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzlePharmacyApiKeyVerificationAdapter } from '@/modules/inventory/infrastructure/adapters/drizzle-pharmacy-api-key-verification.adapter.js'
import type { PharmacyApiKeyVerificationInput } from '@/modules/inventory/application/ports/pharmacy-api-key-verification.port.js'
import {
  PharmacyApiKeyInvalidError,
  PharmacyRequestReplayedError,
  PharmacySignatureInvalidError,
  PharmacyTimestampOutOfWindowError,
} from '@dorutj/contracts'

const TEST_DATABASE_URL =
  process.env.INVENTORY_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'
const TEST_REDIS_URL =
  process.env.INVENTORY_TEST_REDIS_URL ??
  process.env.REDIS_URL ??
  'redis://:dorutj_dev_redis_password@localhost:6379'

const PROBE_TIMEOUT_MS = 1_500

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

async function isRedisReachable(url: string): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: PROBE_TIMEOUT_MS, maxRetriesPerRequest: 1 })
  client.on('error', () => undefined)
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

const [postgresAvailable, redisAvailable] = await Promise.all([
  isPostgresReachable(TEST_DATABASE_URL),
  isRedisReachable(TEST_REDIS_URL),
])

describe.skipIf(!postgresAvailable || !redisAvailable)(
  'DrizzlePharmacyApiKeyVerificationAdapter — integration (DTJ-156, D-11)',
  () => {
    let pool: Pool
    let db: NodePgDatabase
    let redis: Redis
    let adapter: DrizzlePharmacyApiKeyVerificationAdapter
    let pharmacyId: string

    beforeAll(() => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      db = drizzle(pool)
      redis = new Redis(TEST_REDIS_URL)
      adapter = new DrizzlePharmacyApiKeyVerificationAdapter(db, redis)
    })

    afterAll(async () => {
      await pool.end().catch(() => undefined)
      await redis.quit().catch(() => undefined)
    })

    async function seedPharmacy(): Promise<string> {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
         VALUES ($1, 'Test Pharmacy', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000000')`,
        [id],
      )
      return id
    }

    /** Заводит ключ `keyId.secret`, возвращает пару для построения заголовков. */
    async function seedApiKey(params: {
      readonly pharmacyId: string | null
      readonly chainId?: string | null
      readonly isActive?: boolean
    }): Promise<{ readonly keyId: string; readonly secret: string }> {
      const keyId = randomUUID().replace(/-/gu, '').slice(0, 12)
      const secret = randomUUID().replace(/-/gu, '')
      const keyHash = await argon2.hash(secret)
      await pool.query(
        `INSERT INTO pharmacy_api_keys (pharmacy_id, chain_id, key_hash, key_prefix, is_active)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          params.pharmacyId,
          params.chainId ?? null,
          keyHash,
          keyId,
          params.isActive ?? true,
        ],
      )
      return { keyId, secret }
    }

    /** Строит валидный `PharmacyApiKeyVerificationInput` (шаги 7-8 SRS-API-033) для пары ключа. */
    function buildValidInput(
      params: { readonly keyId: string; readonly secret: string },
      overrides: Partial<PharmacyApiKeyVerificationInput> = {},
    ): PharmacyApiKeyVerificationInput {
      const method = 'POST'
      const path = '/api/v1/inventory/batch-update'
      const timestamp = String(Math.floor(Date.now() / 1000))
      const nonce = randomUUID()
      const rawBody = Buffer.from(JSON.stringify({ items: [] }))
      const bodyHash = createHash('sha256').update(rawBody).digest('hex')
      const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`
      const signature = createHmac('sha256', params.secret).update(canonical).digest('hex')
      return {
        keyId: params.keyId,
        secret: params.secret,
        timestamp,
        nonce,
        signature,
        method,
        path,
        rawBody,
        mtlsVerifiedHeader: undefined,
        ...overrides,
      }
    }

    beforeEach(async () => {
      // Не трогаем `pharmacies` (разделяемая таблица, см. отчёт сдачи блока C) —
      // свежий `pharmacyId` на тест уникален (`randomUUID()`), truncate не нужен.
      await db.execute('TRUNCATE pharmacy_api_keys')
      pharmacyId = await seedPharmacy()
    })

    afterEach(async () => {
      // Nonce-ключи используют `randomUUID()` per-test — не пересекаются между
      // прогонами, но чистим паттерн на всякий случай, чтобы Redis не копил мусор.
      const keys = await redis.keys('pharmacy_nonce:*')
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    })

    it('валидный ключ + корректная HMAC-подпись — успех, возвращает { pharmacyId, chainId: null }', async () => {
      const pair = await seedApiKey({ pharmacyId })
      const input = buildValidInput(pair)
      const result = await adapter.verify(input)
      expect(result).toEqual({ pharmacyId, chainId: null })
    })

    it('неверный секрет — PharmacyApiKeyInvalidError, argon2.verify не совпадает', async () => {
      const pair = await seedApiKey({ pharmacyId })
      const input = buildValidInput({ keyId: pair.keyId, secret: 'wrong-secret-value' })
      await expect(adapter.verify(input)).rejects.toBeInstanceOf(PharmacyApiKeyInvalidError)
    })

    it('неактивный ключ (is_active=false) — PharmacyApiKeyInvalidError (эквивалент revoked)', async () => {
      const pair = await seedApiKey({ pharmacyId, isActive: false })
      const input = buildValidInput(pair)
      await expect(adapter.verify(input)).rejects.toBeInstanceOf(PharmacyApiKeyInvalidError)
    })

    it('несуществующий keyId — PharmacyApiKeyInvalidError', async () => {
      const input = buildValidInput({ keyId: 'nonexistent12', secret: 'whatever' })
      await expect(adapter.verify(input)).rejects.toBeInstanceOf(PharmacyApiKeyInvalidError)
    })

    it('повтор nonce — РЕАЛЬНЫЙ Redis SET NX ловит replay на второй попытке', async () => {
      const pair = await seedApiKey({ pharmacyId })
      const input = buildValidInput(pair)
      const first = await adapter.verify(input)
      expect(first.pharmacyId).toBe(pharmacyId)
      // Тот же nonce, свежий timestamp/подпись — но nonce уже "потрачен" в Redis.
      await expect(adapter.verify(input)).rejects.toBeInstanceOf(PharmacyRequestReplayedError)
    })

    it('просроченный timestamp (> 300с) — PharmacyTimestampOutOfWindowError', async () => {
      const pair = await seedApiKey({ pharmacyId })
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600)
      const input = buildValidInput(pair, { timestamp: staleTimestamp })
      // Подпись строится buildValidInput ДО override — нужно пересчитать canonical
      // со staleTimestamp, иначе упадёт на signature раньше timestamp-проверки.
      const rebuilt = rebuildSignatureForTimestamp(pair, input, staleTimestamp)
      await expect(adapter.verify(rebuilt)).rejects.toBeInstanceOf(PharmacyTimestampOutOfWindowError)
    })

    it('неверная подпись — PharmacySignatureInvalidError', async () => {
      const pair = await seedApiKey({ pharmacyId })
      const input = buildValidInput(pair, { signature: 'deadbeef'.repeat(8) })
      await expect(adapter.verify(input)).rejects.toBeInstanceOf(PharmacySignatureInvalidError)
    })

    it('ключ, скоупнутый на сеть (chain_id, pharmacy_id=NULL) — отклоняется (ГЭП №3)', async () => {
      const chainId = randomUUID()
      // `pharmacy_api_keys.chain_id` — FK на `pharmacy_chains(id)` — нужна валидная строка.
      await pool.query(
        `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn)
         VALUES ($1, 'Test Chain', 'Test Chain LLC', $2)`,
        [chainId, `TIN-${chainId.slice(0, 10)}`],
      )
      const pair = await seedApiKey({ pharmacyId: null, chainId })
      const input = buildValidInput(pair)
      await expect(adapter.verify(input)).rejects.toBeInstanceOf(PharmacyApiKeyInvalidError)
    })

    /** Пересобирает canonical/signature для нового `timestamp` тем же секретом. */
    function rebuildSignatureForTimestamp(
      pair: { readonly keyId: string; readonly secret: string },
      input: PharmacyApiKeyVerificationInput,
      timestamp: string,
    ): PharmacyApiKeyVerificationInput {
      const bodyHash = createHash('sha256').update(input.rawBody).digest('hex')
      const canonical = `${input.method}\n${input.path}\n${timestamp}\n${input.nonce}\n${bodyHash}`
      const signature = createHmac('sha256', pair.secret).update(canonical).digest('hex')
      return { ...input, timestamp, signature }
    }
  },
)
