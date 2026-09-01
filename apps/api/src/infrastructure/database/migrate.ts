/**
 * `migrate.ts` (EP-01, DTJ-012, SRS-DB-031/032) — программный раннер
 * `drizzle-kit migrate` для вызова из `docker-entrypoint.sh` и CI.
 *
 * Идемпотентен (журнал `drizzle/meta/_journal.json` отслеживает применённые
 * миграции). При недоступности БД — бросает с понятным сообщением и
 * таймаутом (`DB_CONNECT_TIMEOUT_MS` из ENV, SRS-DB-032).
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import pino from 'pino'

const DEFAULT_DB_CONNECT_TIMEOUT_MS = 5_000
const DB_POOL_MAX_DEFAULT = 10

const dbUrl = process.env.DATABASE_URL
if (dbUrl === undefined || dbUrl.length === 0) {
  // eslint-disable-next-line no-console -- CLI-скрипт, не часть Nest-приложения.
  console.error('DATABASE_URL is required for db:migrate')
  process.exit(1)
}

const connectTimeoutMs = Number(process.env.DB_CONNECT_TIMEOUT_MS) || DEFAULT_DB_CONNECT_TIMEOUT_MS
const poolMax = Number(process.env.DB_POOL_MAX) || DB_POOL_MAX_DEFAULT

// Standalone pino-логгер: миграция запускается ДО bootstrap'а Nest, без DI.
const logger = pino({ name: 'db-migrate', level: process.env.LOG_LEVEL ?? 'info' })
const pool = new Pool({
  connectionString: dbUrl,
  max: poolMax,
  connectionTimeoutMillis: connectTimeoutMs,
})

async function runMigrations(): Promise<void> {
  const db = drizzle(pool)
  logger.info('Applying migrations from ./migrations...')
  await migrate(db, { migrationsFolder: './migrations' })
  logger.info('Migrations applied successfully')
  await pool.end()
}

runMigrations().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  logger.error({ err: error }, `Migration failed: ${message}`)
  void pool.end().finally(() => {
    process.exit(1)
  })
})
