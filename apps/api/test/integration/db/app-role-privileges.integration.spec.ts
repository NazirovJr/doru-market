/**
 * Интеграционный тест ролевой модели БД `app_role` (внеплановая задача, поручение CTO по
 * итогам приёмки EP-10 — SRS-DB-024/030, миграция `0031_app_role_privileges.sql`). РЕАЛЬНЫЙ
 * Postgres, без Testcontainers (решение архитектора, `reports/EP09-CTO-BRIEF.md`,
 * прецедент — `payments-migration.integration.spec.ts`).
 *
 * Подключение ИМЕННО как `app_role` — отдельная строка подключения (`APP_ROLE_DATABASE_URL`),
 * НЕ общий `DATABASE_URL` тестового прогона (тот подключается как `test`, у которой нет и не
 * должно быть отношения к прикладной ролевой модели).
 *
 * Проверяет:
 *  1. `app_role` — НЕ владелец НИ ОДНОЙ таблицы схемы `public` и НЕ суперпользователь
 *     (`pg_roles.rolsuper=false`). Это ключевая проверка задания: владелец таблицы обходит
 *     REVOKE безусловно, тест на привилегии в этом случае зеленеет по неверной причине.
 *  2. `escrow_ledger` — append-only на уровне привилегий роли (SRS-DB-024/042, TC-DB-017):
 *     INSERT/SELECT проходят, UPDATE/DELETE падают с кодом `42501` (`insufficient_privilege`) —
 *     проверяется именно код ошибки (`error.code`), не текст сообщения.
 *  3. Обычная таблица (`orders`) НЕ зажата — UPDATE/DELETE проходят. Без этой проверки первая
 *     часть теста доказывала бы только «роль сломана», не «роль ограничена целенаправленно».
 *  4. `ALTER DEFAULT PRIVILEGES` (миграция, §4) — таблица, созданная ПОСЛЕ миграции, сразу
 *     видна `app_role` с полным CRUD БЕЗ отдельного GRANT — иначе модель прав протухает при
 *     первой же новой таблице следующей миграции.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const APP_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test2'

function withCredentials(url: string, username: string, password: string): string {
  try {
    const parsed = new URL(url)
    parsed.username = username
    parsed.password = password
    return parsed.toString()
  } catch {
    return url
  }
}

// Дев-дефолты, уже коммитятся в открытом виде в миграции 0031 и (для dorutj_migrator) в
// `infra/docker/docker-compose.yml` — заведомо непроизводственные (правило 13 AGENTS.md).
const MIGRATOR_DATABASE_URL =
  process.env.APP_ROLE_MIGRATOR_DATABASE_URL ?? withCredentials(APP_DATABASE_URL, 'dorutj_migrator', 'dorutj_dev_only_password')
const APP_ROLE_DATABASE_URL =
  process.env.APP_ROLE_TEST_DATABASE_URL ?? withCredentials(APP_DATABASE_URL, 'app_role', 'dorutj_dev_app_role_password')

const PROBE_TIMEOUT_MS = 1_500

async function isReachable(url: string): Promise<boolean> {
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

const migratorAvailable = await isReachable(MIGRATOR_DATABASE_URL)
const appRoleAvailable = migratorAvailable && (await isReachable(APP_ROLE_DATABASE_URL))

interface FixtureIds {
  readonly tenantId: string
  readonly userId: string
  readonly orderAId: string // держит escrow_ledger-запись (append-only сценарий)
  readonly orderBId: string // «обычная» таблица — позитивный UPDATE/DELETE
}

async function insertOrderFixture(pool: Pool, orderNumberSuffix: string): Promise<FixtureIds> {
  const tenantId = randomUUID()
  const userId = randomUUID()
  const orderAId = randomUUID()
  const orderBId = randomUUID()
  const slug = `app-role-priv-${orderNumberSuffix}`

  await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, slug])
  await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [userId, tenantId])

  for (const [orderId, orderNumber] of [
    [orderAId, `ARP-A-${orderNumberSuffix}`],
    [orderBId, `ARP-B-${orderNumberSuffix}`],
  ] as const) {
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, payment_method, items_total_tjs, delivery_fee_tjs,
          total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, 'alif_mobi', 10.00, 0.00, 10.00, 'x', $4, gen_random_uuid())`,
      [orderId, orderNumber, userId, tenantId],
    )
  }

  return { tenantId, userId, orderAId, orderBId }
}

describe.skipIf(!appRoleAvailable)('app_role — модель привилегий БД (SRS-DB-024/030, миграция 0031)', () => {
  let migratorPool: Pool
  let appRolePool: Pool
  let fixture: FixtureIds
  let escrowLedgerId: string

  beforeAll(async () => {
    migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
    appRolePool = new Pool({ connectionString: APP_ROLE_DATABASE_URL })

    // Фикстуры создаются ЧЕРЕЗ app_role — заодно доказывает, что обычный CRUD-путь установки
    // рабочий (а не то, что тест обходит роль ради собственного удобства).
    fixture = await insertOrderFixture(appRolePool, randomUUID().slice(0, 8))

    const insertResult = await appRolePool.query<{ id: string }>(
      `INSERT INTO escrow_ledger (order_id, entry_type, direction, amount_diram)
       VALUES ($1, 'hold_created', 'debit', 1000) RETURNING id`,
      [fixture.orderAId],
    )
    escrowLedgerId = insertResult.rows[0]?.id ?? ''
  })

  afterAll(async () => {
    // app_role не может DELETE escrow_ledger (это и есть предмет теста) — уборка мусора идёт
    // под dorutj_migrator (владелец таблиц, обходит REVOKE как и положено суперпользователю).
    // DELETE orders каскадит на оставшуюся строку escrow_ledger (ON DELETE CASCADE, 0029_payments.sql).
    await migratorPool.query(`DELETE FROM orders WHERE id = ANY($1)`, [[fixture.orderAId, fixture.orderBId]]).catch(() => undefined)
    await migratorPool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]).catch(() => undefined)
    await migratorPool.query(`DELETE FROM tenants WHERE id = $1`, [fixture.tenantId]).catch(() => undefined)

    await appRolePool.end().catch(() => undefined)
    await migratorPool.end().catch(() => undefined)
  })

  describe('app_role — не владелец и не суперпользователь (иначе REVOKE ниже не работал бы вовсе)', () => {
    it('pg_roles.rolsuper = false', async () => {
      const result = await migratorPool.query<{ rolsuper: boolean }>(`SELECT rolsuper FROM pg_roles WHERE rolname = 'app_role'`)
      expect(result.rows[0]?.rolsuper).toBe(false)
    })

    it('app_role не владеет НИ ОДНОЙ таблицей схемы public', async () => {
      const result = await migratorPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'app_role'`,
      )
      expect(result.rows[0]?.count).toBe('0')
    })

    it('владелец escrow_ledger — DDL-роль (dorutj_migrator), не app_role', async () => {
      const result = await migratorPool.query<{ tableowner: string }>(
        `SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'escrow_ledger'`,
      )
      expect(result.rows[0]?.tableowner).not.toBe('app_role')
    })
  })

  describe('escrow_ledger — append-only на уровне привилегий (SRS-DB-024/042, TC-DB-017)', () => {
    it('INSERT прошёл в beforeAll (escrow_ledger.id получен)', () => {
      expect(escrowLedgerId).not.toBe('')
    })

    it('SELECT проходит — строка видна под app_role', async () => {
      const result = await appRolePool.query<{ id: string }>(`SELECT id FROM escrow_ledger WHERE id = $1`, [escrowLedgerId])
      expect(result.rows).toHaveLength(1)
    })

    it('UPDATE падает с 42501 (insufficient_privilege), строка не меняется', async () => {
      await expect(
        appRolePool.query(`UPDATE escrow_ledger SET amount_diram = 2000 WHERE id = $1`, [escrowLedgerId]),
      ).rejects.toMatchObject({ code: '42501' })

      const unchanged = await migratorPool.query<{ amount_diram: string }>(
        `SELECT amount_diram FROM escrow_ledger WHERE id = $1`,
        [escrowLedgerId],
      )
      expect(unchanged.rows[0]?.amount_diram).toBe('1000')
    })

    it('DELETE падает с 42501 (insufficient_privilege), строка не удалена', async () => {
      await expect(appRolePool.query(`DELETE FROM escrow_ledger WHERE id = $1`, [escrowLedgerId])).rejects.toMatchObject({
        code: '42501',
      })

      const stillThere = await migratorPool.query<{ id: string }>(`SELECT id FROM escrow_ledger WHERE id = $1`, [escrowLedgerId])
      expect(stillThere.rows).toHaveLength(1)
    })
  })

  describe('orders — обычная таблица: UPDATE/DELETE НЕ ограничены (роль ограничена целенаправленно, не сломана)', () => {
    it('UPDATE проходит', async () => {
      const result = await appRolePool.query(`UPDATE orders SET delivery_address = 'updated-by-app-role' WHERE id = $1`, [
        fixture.orderBId,
      ])
      expect(result.rowCount).toBe(1)
    })

    it('DELETE проходит', async () => {
      const result = await appRolePool.query(`DELETE FROM orders WHERE id = $1`, [fixture.orderBId])
      expect(result.rowCount).toBe(1)
    })
  })

  describe('ALTER DEFAULT PRIVILEGES — новая таблица получает права автоматически (миграция 0031, §4)', () => {
    it('таблица, созданная dorutj_migrator ПОСЛЕ миграции, сразу даёт app_role полный CRUD без отдельного GRANT', async () => {
      const probeTable = `_default_priv_probe_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      try {
        await migratorPool.query(`CREATE TABLE public."${probeTable}" (id uuid PRIMARY KEY, note text)`)

        const rowId = randomUUID()
        await expect(
          appRolePool.query(`INSERT INTO "${probeTable}" (id, note) VALUES ($1, 'x')`, [rowId]),
        ).resolves.toMatchObject({ rowCount: 1 })
        await expect(appRolePool.query(`SELECT id FROM "${probeTable}" WHERE id = $1`, [rowId])).resolves.toMatchObject({
          rowCount: 1,
        })
        await expect(appRolePool.query(`UPDATE "${probeTable}" SET note = 'y' WHERE id = $1`, [rowId])).resolves.toMatchObject({
          rowCount: 1,
        })
        await expect(appRolePool.query(`DELETE FROM "${probeTable}" WHERE id = $1`, [rowId])).resolves.toMatchObject({
          rowCount: 1,
        })
      } finally {
        await migratorPool.query(`DROP TABLE IF EXISTS public."${probeTable}"`).catch(() => undefined)
      }
    })
  })

  describe.skipIf(!migratorAvailable)('Идемпотентность миграции 0031 (правило 11 AGENTS.md)', () => {
    /**
     * ИСПРАВЛЕНО (гейт CI, воспроизведение реального прогона `test:integration` — файлы
     * `test/integration/db/*.spec.ts` идут строго последовательно в ОДНОМ процессе,
     * `fileParallelism: false`, `apps/api/vitest.integration.config.ts`). `GRANT SELECT,
     * INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role` (буквальная строка
     * `0031_app_role_privileges.sql`) ЗАДЕВАЕТ ЛЮБУЮ таблицу `public`, СУЩЕСТВУЮЩУЮ на момент
     * запуска — включая `audit_log` (заведена ПОЗЖЕ, миграцией `0034`, которая сразу после
     * `CREATE TABLE` сужает её тем же приёмом, что и `escrow_ledger`, см. `0031` строки 24-29 и
     * `0034_support_tickets_audit_log.sql`/`0046_audit_log_revoke_update_delete.sql`). Прежняя
     * версия этого блока откатывала узкий грант ТОЛЬКО для `escrow_ledger` — `audit_log`
     * оставалась с полным CRUD у `app_role` до конца прогона всего файла и ЛОМАЛА
     * `test/integration/db/audit-log-revoke.e2e.spec.ts` (алфавитно следующий в том же
     * каталоге, DTJ-374, SRS-ADM-064): `UPDATE`/`DELETE` под `app_role` там ожидаются
     * `42501`, но проходили — REVOKE был отменён ЭТИМ блоком. Симметричный REVOKE
     * (guarded `to_regclass`, тот же идиом, что сам `0031`, — на случай, если когда-нибудь
     * этот тест-файл запустят ДО применения `0034`/`audit_log`) восстанавливает ТОЧНО ТУ ЖЕ
     * итоговую матрицу прав, которую даёт полный реальный прогон миграций по порядку —
     * тест обязан проверять состояние, к которому приводят реальные миграции, не оставлять
     * общую БД в промежуточном/некорректном состоянии для соседних файлов.
     */
    it('повторное применение GRANT/REVOKE/ALTER DEFAULT PRIVILEGES не бросает и не меняет итоговую матрицу прав', async () => {
      await migratorPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role`)
      await migratorPool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role`)
      await migratorPool.query(`REVOKE UPDATE, DELETE ON public.escrow_ledger FROM app_role`)
      // Симметрично `0034_support_tickets_audit_log.sql`/`0046_audit_log_revoke_update_delete.sql`
      // (см. блок-комментарий выше) — без этого широкий GRANT строкой выше отменяет REVOKE,
      // применённый реальными миграциями, и ломает `audit-log-revoke.e2e.spec.ts`.
      await migratorPool.query(
        `DO $$
         BEGIN
           IF to_regclass('public.audit_log') IS NOT NULL THEN
             EXECUTE 'REVOKE UPDATE, DELETE ON public.audit_log FROM app_role';
           END IF;
         END
         $$`,
      )
      await expect(
        migratorPool.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator IN SCHEMA public
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role`,
        ),
      ).resolves.toBeDefined()

      const privileges = await migratorPool.query<{
        can_select: boolean
        can_insert: boolean
        can_update: boolean
        can_delete: boolean
      }>(
        `SELECT
           has_table_privilege('app_role','escrow_ledger','SELECT') AS can_select,
           has_table_privilege('app_role','escrow_ledger','INSERT') AS can_insert,
           has_table_privilege('app_role','escrow_ledger','UPDATE') AS can_update,
           has_table_privilege('app_role','escrow_ledger','DELETE') AS can_delete`,
      )
      expect(privileges.rows[0]).toEqual({ can_select: true, can_insert: true, can_update: false, can_delete: false })

      const auditLogPrivileges = await migratorPool.query<{
        can_update: boolean
        can_delete: boolean
      }>(
        `SELECT
           has_table_privilege('app_role','audit_log','UPDATE') AS can_update,
           has_table_privilege('app_role','audit_log','DELETE') AS can_delete`,
      )
      expect(auditLogPrivileges.rows[0]).toEqual({ can_update: false, can_delete: false })
    })
  })
})
