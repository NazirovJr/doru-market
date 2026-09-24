/**
 * Идемпотентный upsert `notification_templates` (DTJ-369, DoD п.6: `pnpm db:seed` идемпотентен,
 * `ON CONFLICT (event_type, channel, locale) DO UPDATE`, тот же приём, что `i18n-overrides-
 * catalog.seed.ts`, DTJ-103).
 *
 * Каждая строка сида проходит через `NotificationTemplate.create()` (домен) ДО вставки — тот же
 * приём, что `seed-catalog.ts` для `Medicine.create()`: seed обязан пройти через тот же домен,
 * что и продакшен-путь, иначе может создать невалидное состояние (например, `subject` на
 * `telegram`-строке из-за опечатки в `events/*.seed.ts`) — ошибка домена бросается ДО записи в БД,
 * не после.
 *
 * Standalone CLI entrypoint (тот же приём, что `feature-flags.seed.ts`) — позволяет пересеять
 * ТОЛЬКО этот блок: `tsx src/db/seed/notification-templates/seed-notification-templates.ts`.
 * Основной путь подключения к рантайму — вызов из `seed-catalog.run.ts:main()`, `pnpm db:seed`.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { notificationTemplates } from '@/db/schema/notification-templates.js'
import { NotificationTemplate } from '@/modules/notifications/domain/notification-template.entity.js'
import { NOTIFICATION_TEMPLATE_SEED_ROWS } from './index.js'
import type { NotificationTemplateSeedRow } from './types.js'

/** Валидирует инвариант домена (SRS-ADM-055) ДО вставки — бросает при невалидном сид-файле, не молчит. */
function validateSeedRow(row: NotificationTemplateSeedRow, now: Date): void {
  NotificationTemplate.create(
    {
      id: crypto.randomUUID(),
      eventType: row.eventType,
      channel: row.channel,
      locale: row.locale,
      subject: row.subject,
      body: row.body,
      variablesSchema: row.variablesSchema,
    },
    now,
  )
}

export async function seedNotificationTemplates(db: NodePgDatabase): Promise<{ upserted: number }> {
  const now = new Date()
  for (const row of NOTIFICATION_TEMPLATE_SEED_ROWS) {
    validateSeedRow(row, now)
    // eslint-disable-next-line no-await-in-loop -- seed-скрипт последователен по конвенции проекта (см. seed-catalog.run.ts insertCategories)
    await db
      .insert(notificationTemplates)
      .values({
        eventType: row.eventType,
        channel: row.channel,
        locale: row.locale,
        subject: row.subject,
        body: row.body,
        variablesSchema: row.variablesSchema,
      })
      .onConflictDoUpdate({
        target: [notificationTemplates.eventType, notificationTemplates.channel, notificationTemplates.locale],
        set: { subject: row.subject, body: row.body, variablesSchema: row.variablesSchema, updatedAt: now },
      })
  }
  return { upserted: NOTIFICATION_TEMPLATE_SEED_ROWS.length }
}

const DEFAULT_DB_CONNECT_TIMEOUT_MS = 5_000

async function main(): Promise<void> {
  if (process.env.DORUTJ_SEED_SKIP_MAIN === '1') return

  const dbUrl = process.env.DATABASE_URL
  if (dbUrl === undefined || dbUrl.length === 0) {
    // eslint-disable-next-line no-console -- CLI-скрипт, не часть Nest-приложения.
    console.error('DATABASE_URL is required for db:seed')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: DEFAULT_DB_CONNECT_TIMEOUT_MS })
  try {
    const db = drizzle(pool)
    const result = await seedNotificationTemplates(db)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.log(`[db:seed:notification-templates] OK — upserted ${String(result.upserted)} notification_templates rows`)
    process.exitCode = 0
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.error(`[db:seed:notification-templates] FAILED: ${message}`)
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const invokedDirectly =
  process.argv[1]?.endsWith('seed-notification-templates.ts') === true ||
  process.argv[1]?.endsWith('seed-notification-templates') === true
if (invokedDirectly) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.error('[db:seed:notification-templates] failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
