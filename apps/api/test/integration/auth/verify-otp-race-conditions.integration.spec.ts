/**
 * `VerifyOtpUseCase` — self-deadlock пула соединений и атомарность (волна 6, дефект найден
 * аудитом при исправлении ТОЧНО ТАКОГО ЖЕ дефекта в checkout, DTJ-231/233; разбор и обоснование
 * лечения — JSDoc `verify-otp.use-case.ts` класса и `resolveUser`/`createSession`).
 *
 * **Уровень теста — `VerifyOtpUseCase.execute()` напрямую (`app.get(VerifyOtpUseCase)`), не
 * HTTP** — тот же приём, что `test/integration/orders/checkout-race-conditions.integration.spec.ts`
 * (комментарий там же объясняет выбор: гонки бьют в ТУ ЖЕ БД, минус транспортный слой).
 * `otp_codes`-строки сеются НАПРЯМУЮ через `pool.query(INSERT ...)` (не через
 * `POST /auth/otp/request`) — HTTP-путь одним IP упёрся бы в
 * `OTP_REQUEST_MAX_PER_IP_PER_HOUR=20` (`test-app.ts` `TEST_ENV`) на 30 конкурентных
 * пользователях теста «Нагрузочный» ниже, что не относится к предмету этого файла.
 * `codeHash` считается ТЕМ ЖЕ алгоритмом, что `VerifyOtpUseCase.hashCode`
 * (`sha256(code + ':' + otpRequestId)`, `id` строки — соль, см. JSDoc `db/schema/otp-codes.ts`).
 *
 * **Тест 1 (rollback, ДОКАЗАТЕЛЬСТВО атомарности на живом Postgres).** `createTestApp({
 * overrideJwtSigner })` подменяет `JWT_SIGNER` на инстанс, бросающий изнутри
 * `execute()`'s `uow.run(tx => ...)` — `signAccessToken` вызывается ПОСЛЕДНИМ шагом
 * `completeVerification`, ПОСЛЕ `resolveUser` (create user), `createSession` (create
 * auth_sessions) и `markConsumed` (update otp_codes), но ДО возврата колбэка (то есть ДО
 * `db.transaction` commit). Брошенное исключение откатывает ВСЮ транзакцию — тест проверяет,
 * что НИ ОДНА из трёх записей не осталась в БД (не «результат ошибочен», а «данных вообще нет»).
 *
 * **Тест 2 (конкурентность ≥ `DEFAULT_POOL_MAX`, self-deadlock).** 30 РАЗНЫХ пользователей
 * (30 > `DEFAULT_POOL_MAX=10`, `infrastructure/database/drizzle.provider.ts`), каждый со своим
 * `otpRequestId`/`code`/`phone`, конкурентно `Promise.all(...).map(execute)`. ДО фикса (`tx` не
 * прокидывался в `UsersRepository`/`AuthSessionsRepository`) это воспроизводило ТОТ ЖЕ
 * self-deadlock, что и в checkout (см. её JSDoc за `pg_stat_activity`-диагностикой: ВСЕ
 * соединения пула `idle in transaction`/`query='begin'`/`wait_event=ClientRead`, `pg_locks`
 * пуст). Жёсткий таймаут теста (`60_000`, а не платформенный дефолт) — сам детектор дефекта:
 * зависший пул НЕ бросает ошибку, тест просто никогда не резолвится без него.
 */
import { randomUUID, createHash } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { VerifyOtpUseCase, type VerifyOtpInput } from '@/modules/auth/application/use-cases/verify-otp.use-case.js'
import type { JwtSignerPort } from '@/modules/auth/application/ports/jwt-signer.port.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { users } from '@/db/schema/users.js'
import { authSessions } from '@/db/schema/auth-sessions.js'
import { otpCodes } from '@/db/schema/otp-codes.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.AUTH_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const CONCURRENCY_TEST_TIMEOUT_MS = 60_000
const CONCURRENT_USER_COUNT = 30 // > DEFAULT_POOL_MAX=10 (infrastructure/database/drizzle.provider.ts)
const SHA256_HEX_LENGTH = 64
const OTP_TTL_MINUTES = 5
const DEVICE_LABEL = 'integration-test'
const USER_AGENT = 'vitest'
const IP_ADDRESS = '203.0.113.1'
/** Совпадает с `PhoneNumber` VO (`+992` + 9 цифр, `phone-number.vo.ts`). */
const PHONE_BASE = 900_000_000

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

/** ОТДЕЛЬНЫЙ тенант — параллельные integration-файлы бьют в ТУ ЖЕ `dorutj_test`. */
const TENANT_ID = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
const TENANT_SLUG = 'test-auth-race-w6'

/** `sha256(code + ':' + otpRequestId)` — ТОТ ЖЕ алгоритм, что `VerifyOtpUseCase.hashCode`. */
function hashCode(code: string, otpRequestId: string): string {
  return createHash('sha256').update(`${code}:${otpRequestId}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
}

function phoneForIndex(index: number): string {
  return `+992${String(PHONE_BASE + index)}`
}

describe.skipIf(!postgresAvailable)('VerifyOtpUseCase — self-deadlock пула и атомарность (волна 6)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(
      `INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID, TENANT_SLUG],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM otp_codes WHERE tenant_id = $1`, [TENANT_ID])
    await pool.query(`DELETE FROM auth_sessions WHERE tenant_id = $1`, [TENANT_ID])
    await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [TENANT_ID])
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_ID])
    await pool.end().catch(() => undefined)
  })

  /** Сеет `otp_codes`-строку НАПРЯМУЮ (см. JSDoc файла — почему не через HTTP). */
  async function seedOtpCode(phone: string, code: string): Promise<string> {
    const otpRequestId = randomUUID()
    const codeHash = hashCode(code, otpRequestId)
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000)
    await pool.query(
      `INSERT INTO otp_codes (id, tenant_id, subject_ref, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, 'login', $4, $5)`,
      [otpRequestId, TENANT_ID, phone, codeHash, expiresAt],
    )
    return otpRequestId
  }

  function buildInput(otpRequestId: string, code: string): VerifyOtpInput {
    return {
      otpRequestId,
      code,
      tenantId: TENANT_ID,
      deviceLabel: DEVICE_LABEL,
      userAgent: USER_AGENT,
      ipAddress: IP_ADDRESS,
    }
  }

  it('1. Rollback на живом Postgres — падение ПОСЛЕ create user/session/markConsumed (внутри tx, до commit) откатывает ВСЕ ТРИ записи', async () => {
    const throwingSigner: JwtSignerPort = {
      sign: () => {
        throw new Error('injected-rollback-test-failure (волна 6, доказательство атомарности)')
      },
      verify: () => {
        throw new Error('not used in this test')
      },
    }
    const ctx: TestApp = await createTestApp({ overrideJwtSigner: throwingSigner })
    try {
      const app: INestApplication = ctx.app
      const useCase = app.get(VerifyOtpUseCase)
      const db = app.get<DrizzleDb>(DRIZZLE_DB)
      const phone = phoneForIndex(0)
      const code = '123456'
      const otpRequestId = await seedOtpCode(phone, code)

      await expect(useCase.execute(buildInput(otpRequestId, code))).rejects.toThrow(
        'injected-rollback-test-failure',
      )

      const userRows = await db.select().from(users).where(eq(users.phoneNumber, phone))
      expect(userRows).toHaveLength(0) // НЕ создан — резолв user'а откачен вместе со всем остальным

      const sessionRows = await db.select().from(authSessions).where(eq(authSessions.tenantId, TENANT_ID))
      expect(sessionRows).toHaveLength(0) // auth_sessions строка не осталась

      const otpRows = await db.select().from(otpCodes).where(eq(otpCodes.id, otpRequestId))
      expect(otpRows[0]?.consumedAt ?? null).toBeNull() // markConsumed тоже откачен — не "наполовину применено"
    } finally {
      await ctx.close()
    }
  })

  it(
    `Нагрузочный — ${String(CONCURRENT_USER_COUNT)} конкурентных verify-OTP (> DEFAULT_POOL_MAX=10) → все успешны, ноль зависаний пула, ровно по одной user/auth_sessions строке на каждого, все otp_codes.consumed_at заполнены (defect fix — tx прокинут в UsersRepository/AuthSessionsRepository, см. verify-otp.use-case.ts JSDoc)`,
    async () => {
      const ctx: TestApp = await createTestApp()
      try {
        const app: INestApplication = ctx.app
        const useCase = app.get(VerifyOtpUseCase)
        const db = app.get<DrizzleDb>(DRIZZLE_DB)

        const seeds = await Promise.all(
          Array.from({ length: CONCURRENT_USER_COUNT }, async (_unused, index) => {
            const phone = phoneForIndex(index)
            const code = String(100_000 + index)
            const otpRequestId = await seedOtpCode(phone, code)
            return { phone, code, otpRequestId }
          }),
        )

        const results = await Promise.all(
          seeds.map(({ otpRequestId, code }) => useCase.execute(buildInput(otpRequestId, code))),
        )

        const failed = results.filter(isErr)
        expect(failed).toHaveLength(0) // ноль OTP_MISMATCH/OTP_EXPIRED — каждый verify свой уникальный код
        expect(results.filter(isOk)).toHaveLength(CONCURRENT_USER_COUNT)

        const phones = seeds.map((s) => s.phone)
        const userRows = await db.select().from(users).where(eq(users.tenantId, TENANT_ID))
        const createdPhones = new Set(userRows.map((r) => r.phoneNumber))
        expect(userRows).toHaveLength(CONCURRENT_USER_COUNT) // ни дублей, ни потерь
        for (const phone of phones) {
          expect(createdPhones.has(phone)).toBe(true)
        }

        const sessionRows = await db.select().from(authSessions).where(eq(authSessions.tenantId, TENANT_ID))
        expect(sessionRows).toHaveLength(CONCURRENT_USER_COUNT)

        const otpRows = await db.select().from(otpCodes).where(eq(otpCodes.tenantId, TENANT_ID))
        expect(otpRows).toHaveLength(CONCURRENT_USER_COUNT)
        expect(otpRows.every((r) => r.consumedAt !== null)).toBe(true)
      } finally {
        await ctx.close()
      }
    },
    CONCURRENCY_TEST_TIMEOUT_MS,
  )
})
