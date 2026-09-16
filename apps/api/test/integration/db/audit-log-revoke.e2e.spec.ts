/**
 * Интеграционный тест (EP-16, DTJ-374, SRS-ADM-064, TC-ADM-027) — эксплуатационный уровень
 * неизменяемости `audit_log`. РЕАЛЬНЫЙ Postgres, тот же приём подключения/пробы и та же
 * `app_role`-инфраструктура, что `test/integration/db/app-role-privileges.integration.spec.ts`
 * (эквивалентный тест для `escrow_ledger`) — этот файл НЕ дублирует его целиком, только
 * специфичную для `audit_log` часть (AC1 тикета).
 *
 * Подключение ИМЕННО как `app_role` (`APP_ROLE_TEST_DATABASE_URL`/дефолт), НЕ общий
 * `DATABASE_URL` тестового прогона (та роль — `test`, владелец таблиц, обходит `REVOKE`
 * безусловно — тест на привилегии в этом случае зеленел бы по неверной причине).
 *
 * Проверяет:
 *  1. `INSERT`/`SELECT` под `app_role` проходят (append-only разрешает запись и чтение).
 *  2. Прямой SQL `UPDATE audit_log SET reason=...` под `app_role` падает `42501`
 *     (`insufficient_privilege`) — БУКВАЛЬНЫЙ сценарий TC-ADM-027/AC1: подключение НАПРЯМУЮ
 *     через `pg`, не через ORM-репозиторий, чтобы исключить «репозиторий просто не предлагает
 *     метод» как единственную защиту.
 *  3. `DELETE` под `app_role` падает `42501` тем же способом.
 *  4. Строка не меняется/не исчезает после отклонённых попыток (защита реальна, не только
 *     код ошибки без эффекта).
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

// Дев-дефолты, уже коммитятся в открытом виде в миграции 0031 (правило 13 AGENTS.md) —
// заведомо непроизводственные, тот же приём, что `app-role-privileges.integration.spec.ts`.
const MIGRATOR_DATABASE_URL =
  process.env.APP_ROLE_MIGRATOR_DATABASE_URL ??
  withCredentials(APP_DATABASE_URL, 'dorutj_migrator', 'dorutj_dev_only_password')
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

describe.skipIf(!appRoleAvailable)('audit_log — REVOKE UPDATE, DELETE на уровне БД (DTJ-374, SRS-ADM-064, TC-ADM-027)', () => {
  let migratorPool: Pool
  let appRolePool: Pool
  let auditLogId: string

  beforeAll(async () => {
    migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
    appRolePool = new Pool({ connectionString: APP_ROLE_DATABASE_URL })

    // INSERT ЧЕРЕЗ app_role — доказывает, что обычный путь записи рабочий (append-only
    // разрешает INSERT/SELECT, ограничивает только UPDATE/DELETE).
    // `category='control_category_change'` — существующее значение `audit_action_category`
    // (миграция `0034_support_tickets_audit_log.sql`). `'role_grant'` (SRS-ADM-030) ЕЩЁ НЕ
    // добавлено в enum — это делает будущий `DTJ-354` (`ALTER TYPE ... ADD VALUE 'role_grant'`,
    // `blocks` этого тикета), реальный live-INSERT с ним сегодня упал бы `22P02`.
    const insertResult = await appRolePool.query<{ id: string }>(
      `INSERT INTO audit_log (category, entity_type, entity_id, action, metadata)
       VALUES ('control_category_change', 'user', $1, 'grant_platform_role', '{}'::jsonb) RETURNING id`,
      [randomUUID()],
    )
    auditLogId = insertResult.rows[0]?.id ?? ''
  })

  afterAll(async () => {
    // app_role не может DELETE audit_log (предмет этого теста) — уборка под dorutj_migrator
    // (владелец таблицы, обходит REVOKE как и положено суперпользователю миграций).
    await migratorPool.query(`DELETE FROM audit_log WHERE id = $1`, [auditLogId]).catch(() => undefined)
    await appRolePool.end().catch(() => undefined)
    await migratorPool.end().catch(() => undefined)
  })

  it('INSERT прошёл в beforeAll (audit_log.id получен)', () => {
    expect(auditLogId).not.toBe('')
  })

  it('SELECT проходит — строка видна под app_role', async () => {
    const result = await appRolePool.query<{ id: string }>(`SELECT id FROM audit_log WHERE id = $1`, [auditLogId])
    expect(result.rows).toHaveLength(1)
  })

  it('UPDATE падает с 42501 (insufficient_privilege), reason не меняется', async () => {
    await expect(
      appRolePool.query(`UPDATE audit_log SET reason = 'изменено напрямую' WHERE id = $1`, [auditLogId]),
    ).rejects.toMatchObject({ code: '42501' })

    const unchanged = await migratorPool.query<{ reason: string | null }>(`SELECT reason FROM audit_log WHERE id = $1`, [
      auditLogId,
    ])
    expect(unchanged.rows[0]?.reason).toBeNull()
  })

  it('DELETE падает с 42501 (insufficient_privilege), строка не удалена', async () => {
    await expect(appRolePool.query(`DELETE FROM audit_log WHERE id = $1`, [auditLogId])).rejects.toMatchObject({
      code: '42501',
    })

    const stillThere = await migratorPool.query<{ id: string }>(`SELECT id FROM audit_log WHERE id = $1`, [auditLogId])
    expect(stillThere.rows).toHaveLength(1)
  })
})
