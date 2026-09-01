/**
 * Единый Drizzle-клиент `apps/api` (DTJ-051 follow-up, инфраструктура
 * общая для всех модулей).
 *
 * Создаёт ОДИН пул соединений Postgres (через `pg.Pool`), оборачивает его
 * в `drizzle-orm/node-postgres` и предоставляет DI-токеном `DRIZZLE_DB`.
 * Это контракт, на который ссылаются ВСЕ Drizzle-репозитории
 * (см. `application/ports/...` каждого модуля).
 *
 * ВНИМАНИЕ: файл НЕ входит в `files_owned` какого-либо конкретного тикета —
 * это инфраструктура, общая для всех. Создан здесь как часть EP-02, потому
 * что DTJ-052 (TenantRepository) требует существующего Drizzle-провайдера.
 * Будущие тикеты (orders/inventory/...) будут переиспользовать этот же токен.
 *
 * `pool.on('connect', ...)` (DTJ-185, `SRS-DB-017`/`SRS-CAT-015`): `pg_trgm.similarity_threshold`
 * — сессионная GUC-настройка, обязана применяться на КАЖДОЕ новое соединение пула, не один раз
 * глобально (`postgresql.conf`), иначе часть запросов под нагрузкой использует дефолт Postgres
 * `0.3` вместо целевого `0.20` (DTJ-185 «Риски»). Разрешает документированный gap
 * `postgres-suggest.sql.ts` (DTJ-186): «настройка... которую по п.4 тикета DTJ-185 предстоит
 * добавить» — тот же хук покрывает и `search()`, и `suggest()`, любой запрос через `DRIZZLE_DB`.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, type PoolClient } from 'pg'
import { type Provider } from '@nestjs/common'
import { AppConfigService } from '@/config/app-config.service.js'

export const DRIZZLE_DB = Symbol.for('@dorutj/api/drizzle-db')

export type DrizzleDb = NodePgDatabase

/** Максимум соединений в пуле (ENV-переопределение добавлено ниже, DTJ-NNN при необходимости). */
const DEFAULT_POOL_MAX = 10
/** SRS-DB-017: диапазон 0.15-0.25, целевое значение 0.20 (REQ-UX-13), не дефолт Postgres 0.3. */
const PG_TRGM_SIMILARITY_THRESHOLD = 0.2

/**
 * `catch`, не `await`: `pool.on('connect', ...)` не поддерживает async-обработчик — колбэк
 * запускается на каждое новое соединение пула, отказ SET не должен ронять соединение целиком
 * (деградация: это ОДНО соединение обслужит запрос на дефолтном пороге `0.3`, не на `0.20`).
 */
function applyTrigramSimilarityThreshold(client: PoolClient): void {
  void client.query(`SET pg_trgm.similarity_threshold = ${String(PG_TRGM_SIMILARITY_THRESHOLD)}`).catch(() => {
    // Best-effort: см. JSDoc функции. Окружение без `pg_trgm` (маловероятно — расширение
    // включено `0001_extensions.sql`) не должно ронять запуск приложения из-за этой настройки.
  })
}

export const drizzleProvider: Provider = {
  provide: DRIZZLE_DB,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): DrizzleDb => {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: DEFAULT_POOL_MAX,
    })
    pool.on('connect', applyTrigramSimilarityThreshold)
    return drizzle(pool)
  },
}
