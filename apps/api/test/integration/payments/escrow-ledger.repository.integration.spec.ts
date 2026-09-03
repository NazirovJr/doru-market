/**
 * Интеграционный тест `EscrowLedgerRepository`/`DrizzleEscrowLedgerRepository` (EP-10,
 * DTJ-240) — РЕАЛЬНЫЙ Postgres, тот же приём подключения/пробы, что
 * `payments-migration.integration.spec.ts` (DTJ-236, ближайший прецедент этого каталога).
 * Testcontainers не используется (D-EP09-14/31).
 *
 * Проверяет:
 *  1. `append`/`findByOrderId`/`sumByType` — реальный round-trip через `escrow_ledger`.
 *  2. `EscrowLedger.isBalanced()` на записях, реально прочитанных из БД (не только на
 *     сконструированных в памяти unit-тестом фикстурах).
 *  3. ТЕНАНТ-ИЗОЛЯЦИЯ (замечание CTO при приёмке DTJ-240, SRS-API-043/046): `escrow_ledger`
 *     своей колонки `tenant_id` не несёт (канонная схема Группы E) — `findByOrderId`/
 *     `sumByType` скоупят через `orders.tenant_id` (см. JSDoc репозитория). Тест — на живом
 *     Postgres, с ДВУМЯ реальными строками `tenants`: записи журнала заказа тенанта А не
 *     видны при запросе с `tenantId` тенанта Б (пустой массив/`0n`), позитивный контроль
 *     СВОИМ `tenantId` идёт первым, чтобы пустой результат ниже доказывал именно изоляцию.
 *  4. AC5 (DTJ-240) — `app_role` может `SELECT`/`INSERT` на `escrow_ledger`, но НЕ может
 *     `UPDATE`/`DELETE` (`insufficient_privilege`, код 42501) — точная форма исключения
 *     SRS-DB-024, не «таблица целиком недоступна». `app_role`/грант созданы миграцией
 *     `0031_app_role_privileges.sql` (параллельная сессия). `it.skipIf(!appRoleAvailable)` —
 *     живая проба точной формы грантов (`isAppRoleGrantedCorrectly`), не просто «роль
 *     существует» (роли PostgreSQL cluster-wide, гранты per-database — наивная проверка
 *     существования роли дала бы ложноположительный результат, см. её собственный JSDoc).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { DrizzleEscrowLedgerRepository } from '@/modules/payments/infrastructure/repositories/escrow-ledger.repository.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { EscrowLedger } from '@/modules/payments/domain/escrow-ledger.entity.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

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

/**
 * `pg_roles` — CLUSTER-WIDE, не per-database (роль, созданная миграцией `0031` на ЛЮБОЙ базе
 * того же Postgres-инстанса, видна и здесь). Одного `EXISTS (... pg_roles ...)` НЕДОСТАТОЧНО:
 * найдено живым прогоном на dorutj_test3 — `app_role` существует (создана на другой базе тем
 * же кластером), но `information_schema.role_table_grants` на ЭТОЙ базе для неё пуст (GRANT —
 * per-database, миграция `0031` сюда не применялась). Naивная проверка «роль существует» дала
 * бы ложный `UPDATE`/`DELETE` → `insufficient_privilege` ПО ДРУГОЙ причине (нет вообще
 * никаких прав, а не «есть INSERT/SELECT, нет UPDATE/DELETE») — тест «проходил» бы, не
 * доказывая нужного. Проверяем ИМЕННО нужную форму грантов.
 */
async function isAppRoleGrantedCorrectly(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    const result = await pool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_role' AND table_name = 'escrow_ledger'`,
    )
    const privileges = new Set(result.rows.map((r) => r.privilege_type))
    return privileges.has('INSERT') && privileges.has('SELECT') && !privileges.has('UPDATE') && !privileges.has('DELETE')
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

/** `0031_app_role_privileges.sql` — дев-пароль, заведомо непроизводственный (правило 13 AGENTS.md). */
function buildAppRoleUrl(appUrl: string): string {
  const url = new URL(appUrl)
  url.username = 'app_role'
  url.password = 'dorutj_dev_app_role_password'
  return url.toString()
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)
const appRoleAvailable = postgresAvailable && (await isAppRoleGrantedCorrectly(TEST_DATABASE_URL))

describe.skipIf(!postgresAvailable)('EscrowLedgerRepository (DTJ-240)', () => {
  let pool: Pool
  let repository: DrizzleEscrowLedgerRepository
  let tenantId: string
  let customerId: string
  // Второй РЕАЛЬНЫЙ тенант — замечание CTO при приёмке DTJ-240: escrow_ledger своей колонки
  // tenant_id не несёт, скоуп идёт через orders.tenant_id (см. JSDoc репозитория); тест
  // изоляции обязан быть на живом Postgres с двумя реальными строками tenants, не на моке.
  let otherTenantId: string
  const createdOrderIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    const db = drizzle(pool)
    repository = new DrizzleEscrowLedgerRepository(db)

    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      tenantId,
      `dtj240-${tenantId.slice(0, 8)}`,
    ])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])

    otherTenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      otherTenantId,
      `dtj240-other-${otherTenantId.slice(0, 8)}`,
    ])
  })

  afterAll(async () => {
    // `users.tenant_id` без CASCADE — удалить строку `users` ДО `tenants`, иначе она
    // осталась бы осиротевшим мусором (найдено живым прогоном этого файла: `.catch(() =>
    // undefined)` на голом `DELETE FROM tenants` глушил именно эту ошибку, правило 5
    // AGENTS.md — тест обязан убирать за собой, не молчать об этом).
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [otherTenantId])
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    // Правило 5 AGENTS.md: чистим DELETE по своим строкам, не TRUNCATE ... CASCADE.
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM escrow_ledger WHERE order_id = $1', [orderId])
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    }
  })

  /**
   * НАЙДЕНО при первом прогоне этого файла (см. отчёт сдачи, раздел «НАЙДЕННЫЕ ЧУЖИЕ
   * ПРОБЛЕМЫ»): `orders.status` несёт колоночный `DEFAULT 'pending_payment'`
   * (`db/schema/orders.ts`) — верно для non-cash методов, но `payment_method='cash_courier'`
   * ЗАПРЕЩЕНО находиться в `pending_payment` (D-25, `chk_orders_cash_never_escrow`,
   * `0027_orders_cash_never_escrow.sql`). Голый `INSERT` без явного `status` для
   * `cash_courier` наивно наследует дефолт и падает `23514` — констрейнт сработал КОРРЕКТНО
   * (это и есть его задача, defense-in-depth под доменом), но сама колонка-дефолт остаётся
   * ловушкой для любого прямого SQL (сиды/скрипты/будущие тесты), который забудет про D-25.
   * Домен (`Order.create()`) эту ветку всегда переопределяет явно — здесь копируем то же
   * поведение вручную, раз тест намеренно бьёт по БД в обход домена.
   */
  async function seedOrder(paymentMethod: 'alif_mobi' | 'cash_courier'): Promise<string> {
    const orderId = randomUUID()
    const status = paymentMethod === 'cash_courier' ? 'confirmed' : 'pending_payment'
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, payment_method, status, items_total_tjs, delivery_fee_tjs,
          total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, $5, 100.00, 0.00, 100.00, 'x', $6, gen_random_uuid())`,
      [orderId, `DTJ240-${orderId.slice(0, 8)}`, customerId, paymentMethod, status, tenantId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  it('append + findByOrderId — round-trip реальной строки escrow_ledger', async () => {
    const orderId = await seedOrder('alif_mobi')
    const entry = EscrowLedgerEntry.create({
      orderId,
      entryType: 'hold_created',
      direction: 'debit',
      amountDiram: Money.fromDiram(10_000n),
      paymentTransactionRef: 'bank-tx-1',
      reason: null,
      actorUserId: null,
    })

    await repository.append(entry)
    const found = await repository.findByOrderId(tenantId, orderId)

    expect(found).toHaveLength(1)
    expect(found[0]?.entryType).toBe('hold_created')
    expect(found[0]?.direction).toBe('debit')
    expect(found[0]?.amountDiram.diram).toBe(10_000n)
    expect(found[0]?.paymentTransactionRef).toBe('bank-tx-1')
  })

  it('sumByType — суммирует ТОЛЬКО совпадающий entryType этого заказа (bigint, целые дирамы)', async () => {
    const orderId = await seedOrder('alif_mobi')
    await repository.append(
      EscrowLedgerEntry.create({
        orderId,
        entryType: 'hold_created',
        direction: 'debit',
        amountDiram: Money.fromDiram(10_000n),
        paymentTransactionRef: null,
        reason: null,
        actorUserId: null,
      }),
    )
    await repository.append(
      EscrowLedgerEntry.create({
        orderId,
        entryType: 'platform_fee_captured',
        direction: 'credit',
        amountDiram: Money.fromDiram(800n),
        paymentTransactionRef: null,
        reason: null,
        actorUserId: null,
      }),
    )
    await repository.append(
      EscrowLedgerEntry.create({
        orderId,
        entryType: 'captured_to_pharmacy',
        direction: 'credit',
        amountDiram: Money.fromDiram(9_200n),
        paymentTransactionRef: null,
        reason: null,
        actorUserId: null,
      }),
    )

    expect(await repository.sumByType(tenantId, orderId, 'hold_created')).toBe(10_000n)
    expect(await repository.sumByType(tenantId, orderId, 'platform_fee_captured')).toBe(800n)
    expect(await repository.sumByType(tenantId, orderId, 'refunded_to_customer')).toBe(0n)
  })

  it('EscrowLedger.isBalanced() на записях, реально прочитанных из БД — сбалансированный заказ → true', async () => {
    const orderId = await seedOrder('alif_mobi')
    for (const [entryType, direction, amount] of [
      ['hold_created', 'debit', 10_000n],
      ['platform_fee_captured', 'credit', 800n],
      ['captured_to_pharmacy', 'credit', 9_200n],
    ] as const) {
      await repository.append(
        EscrowLedgerEntry.create({
          orderId,
          entryType,
          direction,
          amountDiram: Money.fromDiram(amount),
          paymentTransactionRef: null,
          reason: null,
          actorUserId: null,
        }),
      )
    }

    const entries = await repository.findByOrderId(tenantId, orderId)
    expect(EscrowLedger.isBalanced(entries)).toBe(true)
  })

  it('cash_courier заказ — findByOrderId возвращает пустой массив (§4.6, escrow_ledger никогда не заполняется для наличных)', async () => {
    const orderId = await seedOrder('cash_courier')
    const entries = await repository.findByOrderId(tenantId, orderId)
    expect(entries).toEqual([])
    expect(EscrowLedger.isBalanced(entries)).toBe(true)
  })

  it('ТЕНАНТ-ИЗОЛЯЦИЯ (замечание CTO, SRS-API-043/046): записи журнала заказа тенанта А не видны при запросе с tenantId тенанта Б', async () => {
    const orderId = await seedOrder('alif_mobi')
    await repository.append(
      EscrowLedgerEntry.create({
        orderId,
        entryType: 'hold_created',
        direction: 'debit',
        amountDiram: Money.fromDiram(5_000n),
        paymentTransactionRef: null,
        reason: null,
        actorUserId: null,
      }),
    )

    // Позитивный контроль СНАЧАЛА — своим tenantId данные видны, значит пустой результат ниже
    // доказывает именно изоляцию, а не случайную поломку самого запроса.
    const ownView = await repository.findByOrderId(tenantId, orderId)
    expect(ownView).toHaveLength(1)
    expect(await repository.sumByType(tenantId, orderId, 'hold_created')).toBe(5_000n)

    // Чужой tenantId (otherTenantId) — SRS-API-046: чужая финансовая запись НЕ подтверждается
    // как существующая, ни через findByOrderId (пустой массив), ни через sumByType (0n).
    const foreignView = await repository.findByOrderId(otherTenantId, orderId)
    expect(foreignView).toEqual([])
    expect(await repository.sumByType(otherTenantId, orderId, 'hold_created')).toBe(0n)
  })

  describe('AC5 — привилегии роли БД (SRS-DB-024/030)', () => {
    // `appRoleAvailable` — вычислен top-level await'ом (см. начало файла), тот же приём, что
    // `postgresAvailable`: живая проба соединения ПОД ролью `app_role` ДО регистрации тестов.
    it.skipIf(!appRoleAvailable)(
      'app_role — SELECT/INSERT разрешены, UPDATE/DELETE escrow_ledger отклонены (SRS-DB-024, точная форма исключения)',
      async () => {
        const orderId = await seedOrder('alif_mobi')
        const appRolePool = new Pool({ connectionString: buildAppRoleUrl(TEST_DATABASE_URL) })
        try {
          // Позитивная половина AC5 — не только «UPDATE/DELETE запрещены», но и «SELECT/INSERT
          // по-прежнему работают» (SRS-DB-024 — это СУЖЕНИЕ прав, не полная блокировка таблицы).
          await expect(
            appRolePool.query(
              `INSERT INTO escrow_ledger (order_id, entry_type, direction, amount_diram) VALUES ($1, 'hold_created', 'debit', 1000)`,
              [orderId],
            ),
          ).resolves.toBeDefined()
          await expect(
            appRolePool.query(`SELECT * FROM escrow_ledger WHERE order_id = $1`, [orderId]),
          ).resolves.toMatchObject({ rowCount: 1 })

          await expect(
            appRolePool.query(`UPDATE escrow_ledger SET amount_diram = 999 WHERE order_id = $1`, [orderId]),
          ).rejects.toMatchObject({ code: '42501' })
          await expect(
            appRolePool.query(`DELETE FROM escrow_ledger WHERE order_id = $1`, [orderId]),
          ).rejects.toMatchObject({ code: '42501' })
        } finally {
          await appRolePool.end().catch(() => undefined)
        }
      },
    )
  })
})
