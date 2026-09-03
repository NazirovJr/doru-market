/**
 * `TelegramAuthUseCase` — self-deadlock пула соединений и атомарность (волна 6, второй путь
 * входа, дефект найден аудитом при исправлении ТОЧНО ТАКОГО ЖЕ дефекта в checkout, DTJ-231/233
 * → verify-otp → здесь; разбор — JSDoc `telegram-auth.use-case.ts` класса и `findOrCreateUser`).
 *
 * **Уровень теста — `TelegramAuthUseCase.execute()` напрямую** (`app.get(TelegramAuthUseCase)`),
 * не HTTP — тот же приём, что `verify-otp-race-conditions.integration.spec.ts`/
 * `checkout-race-conditions.integration.spec.ts`. `initData` подписывается ТЕМ ЖЕ алгоритмом,
 * что production-адаптер (`signInitData`, зеркало `twa-security.spec.ts`).
 *
 * **Границы транзакции здесь ÝЖЕ, чем в verify-otp** (см. JSDoc use case'а): только
 * `findOrCreateUser` (find-or-create `User` + `user_telegram_identities`) — ОДНА `uow.run`;
 * `issueTokens` (шаг 10, `AuthSession`/JWT) НАМЕРЕННО вызывается ПОСЛЕ, вне транзакции. Это
 * ОТДЕЛЬНОЕ архитектурное решение, не часть проверяемого здесь дефекта — тесты ниже это
 * учитывают: rollback-тест форсирует падение ВНУТРИ `findOrCreateUser`, не в `issueTokens`.
 *
 * **Тест 1 (rollback).** `createTestApp({ overrideUserTelegramIdentitiesRepository })` подменяет
 * `USER_TELEGRAM_IDENTITIES_REPOSITORY` — `findByTenantAndTelegramId` честно делегирует реальному
 * Drizzle-репозиторию (видит РЕАЛЬНОЕ состояние БД внутри той же `tx`), а `create` БРОСАЕТ. Это
 * ПОСЛЕДНИЙ вызов внутри `findOrCreateUser`'s `uow.run`, ПОСЛЕ `this.users.create(...)` — падение
 * здесь откатывает ОБЕ записи (user + identity), если атомарность реальна.
 *
 * **Тест 2 (конкурентность ≥ `DEFAULT_POOL_MAX`).** 30 РАЗНЫХ `telegramUserId`
 * (30 > `DEFAULT_POOL_MAX=10`), конкурентный `Promise.all(...).map(execute)`. ДО фикса
 * (`this.users.findById`/`this.users.create` без `tx`) — тот же self-deadlock, что в checkout/
 * verify-otp. Жёсткий таймаут (`60_000`) — детектор: зависший пул не бросает, просто не резолвится.
 */
import { createHmac } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { INestApplication } from '@nestjs/common'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isErr, isOk } from '@dorutj/domain-kernel'
import {
  TelegramAuthUseCase,
  type TelegramAuthInput,
} from '@/modules/auth/application/use-cases/telegram-auth.use-case.js'
import type {
  UserTelegramIdentitiesRepository,
  UserTelegramIdentity,
  CreateUserTelegramIdentityInput,
} from '@/modules/auth/application/ports/user-telegram-identities.repository.port.js'
import { DrizzleUserTelegramIdentitiesRepository } from '@/modules/auth/infrastructure/repositories/drizzle-user-telegram-identities.repository.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { users } from '@/db/schema/users.js'
import { userTelegramIdentities } from '@/db/schema/user-telegram-identities.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.AUTH_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const CONCURRENCY_TEST_TIMEOUT_MS = 60_000
const CONCURRENT_USER_COUNT = 30 // > DEFAULT_POOL_MAX=10 (infrastructure/database/drizzle.provider.ts)
const WEBAPP_DATA_LABEL = 'WebAppData'
const TEST_BOT_TOKEN = 'test-bot-token-for-integration'
const IP_ADDRESS = '203.0.113.1'
const USER_AGENT = 'vitest'
const TELEGRAM_USER_ID_BASE = 900_000_000

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

const TENANT_ID = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'
const TENANT_SLUG = 'test-auth-telegram-race-w6'

/** Зеркало production-алгоритма подписи `initData` (см. `twa-security.spec.ts::signInitData`). */
function signInitData(params: Readonly<Record<string, string>>): string {
  const secretKey = createHmac('sha256', WEBAPP_DATA_LABEL).update(TEST_BOT_TOKEN).digest()
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('\n')
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  return `${Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')}&hash=${hash}`
}

function initDataForTelegramUser(telegramUserId: number): string {
  const authDate = Math.floor(Date.now() / 1000) - 10
  return signInitData({
    auth_date: String(authDate),
    user: JSON.stringify({ id: telegramUserId, first_name: `Test-${String(telegramUserId)}` }),
  })
}

/**
 * Всегда бросает на `create` (rollback-тест) — `findByTenantAndTelegramId` делегирует РЕАЛЬНОМУ
 * `DrizzleUserTelegramIdentitiesRepository`, чтобы find-or-create логика `findOrCreateUser` шла
 * по реальной ветке «identity не найдена → создаём», а не по фейковой заглушке.
 */
class ThrowOnCreateIdentitiesRepository implements UserTelegramIdentitiesRepository {
  constructor(private readonly real: DrizzleUserTelegramIdentitiesRepository) {}

  findByTenantAndTelegramId(
    tenantId: string,
    telegramUserId: bigint,
    tx?: unknown,
  ): Promise<UserTelegramIdentity | null> {
    return this.real.findByTenantAndTelegramId(tenantId, telegramUserId, tx)
  }

  create(_input: CreateUserTelegramIdentityInput, _tx?: unknown): Promise<UserTelegramIdentity> {
    throw new Error('injected-rollback-test-failure (волна 6, доказательство атомарности)')
  }
}

describe.skipIf(!postgresAvailable)('TelegramAuthUseCase — self-deadlock пула и атомарность (волна 6)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(
      `INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID, TENANT_SLUG],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM user_telegram_identities WHERE tenant_id = $1`, [TENANT_ID])
    await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [TENANT_ID])
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_ID])
    await pool.end().catch(() => undefined)
  })

  function buildInput(telegramUserId: number): TelegramAuthInput {
    return {
      initData: initDataForTelegramUser(telegramUserId),
      ipAddress: IP_ADDRESS,
      userAgent: USER_AGENT,
      tenantId: TENANT_ID,
    }
  }

  it('1. Rollback на живом Postgres — падение ПОСЛЕДНИМ шагом findOrCreateUser (после users.create, внутри tx, до commit) откатывает И user, И identity', async () => {
    // `fallbackDb` — независимый Drizzle-клиент ТОЙ ЖЕ Postgres ТОЛЬКО для конструктора
    // `DrizzleUserTelegramIdentitiesRepository` (сигнатура требует `DrizzleDb`). НЕ используется
    // фактически: `findByTenantAndTelegramId`/`create` вызываются use case'ом ВСЕГДА с `tx`
    // (`resolveDrizzleClient` предпочитает `tx`, см. `drizzle-tx.util.ts`), поэтому какой
    // именно пул стоит за `this.db` — не важно для этого теста.
    const fallbackDb = drizzle(new Pool({ connectionString: TEST_DATABASE_URL }))
    const realIdentities = new DrizzleUserTelegramIdentitiesRepository(fallbackDb)
    const throwing = new ThrowOnCreateIdentitiesRepository(realIdentities)
    const ctx: TestApp = await createTestApp({ overrideUserTelegramIdentitiesRepository: throwing })
    try {
      const app: INestApplication = ctx.app
      const useCase = app.get(TelegramAuthUseCase)
      const db = app.get<DrizzleDb>(DRIZZLE_DB)
      const telegramUserId = TELEGRAM_USER_ID_BASE

      await expect(useCase.execute(buildInput(telegramUserId))).rejects.toThrow(
        'injected-rollback-test-failure',
      )

      const identityRows = await db
        .select()
        .from(userTelegramIdentities)
        .where(eq(userTelegramIdentities.telegramUserId, BigInt(telegramUserId)))
      expect(identityRows).toHaveLength(0)

      const userRows = await db.select().from(users).where(eq(users.tenantId, TENANT_ID))
      expect(userRows).toHaveLength(0) // users.create ТОЖЕ откачен — не осиротевшая строка
    } finally {
      await ctx.close()
      await fallbackDb.$client.end()
    }
  })

  it(
    `Нагрузочный — ${String(CONCURRENT_USER_COUNT)} конкурентных Telegram-логинов (> DEFAULT_POOL_MAX=10) → все успешны, ноль зависаний пула, ровно по одной user/identity строке на каждого (defect fix — tx прокинут в UsersRepository.findById/create, см. telegram-auth.use-case.ts JSDoc)`,
    async () => {
      const ctx: TestApp = await createTestApp()
      try {
        const app: INestApplication = ctx.app
        const useCase = app.get(TelegramAuthUseCase)
        const db = app.get<DrizzleDb>(DRIZZLE_DB)

        const telegramUserIds = Array.from(
          { length: CONCURRENT_USER_COUNT },
          (_unused, index) => TELEGRAM_USER_ID_BASE + 1 + index,
        )

        const results = await Promise.all(
          telegramUserIds.map((telegramUserId) => useCase.execute(buildInput(telegramUserId))),
        )

        const failed = results.filter(isErr)
        expect(failed).toHaveLength(0)
        expect(results.filter(isOk)).toHaveLength(CONCURRENT_USER_COUNT)

        const identityRows = await db
          .select()
          .from(userTelegramIdentities)
          .where(eq(userTelegramIdentities.tenantId, TENANT_ID))
        expect(identityRows).toHaveLength(CONCURRENT_USER_COUNT) // ни дублей, ни потерь

        const userRows = await db.select().from(users).where(eq(users.tenantId, TENANT_ID))
        expect(userRows).toHaveLength(CONCURRENT_USER_COUNT)
      } finally {
        await ctx.close()
      }
    },
    CONCURRENCY_TEST_TIMEOUT_MS,
  )
})
