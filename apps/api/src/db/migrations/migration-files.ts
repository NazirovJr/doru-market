/**
 * Реестр миграций (EP-04, DTJ-091). Здесь объявляется СПИСОК SQL-файлов, которые
 * применяются в указанном порядке при `pnpm db:migrate`. Сейчас содержит миграции
 * модуля `catalog`; по мере готовности других модулей список ДОПОЛНЯЕТСЯ строками.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE_URL_PATH = fileURLToPath(import.meta.url)
const MODULE_DIR = dirname(FILE_URL_PATH)
const MIGRATIONS_DIR = resolve(MODULE_DIR, '..', '..', '..', 'migrations')

/** Имя файла → SQL. Порядок массива = порядок применения. */
const MIGRATION_FILES: readonly string[] = [
  '0006_catalog_core.sql',
  '0007_catalog_normalize_dosage_form_class.sql',
  '0008_i18n_overrides_review_status.sql',
  // EP-05, DTJ-142: расширения схемы для синхронизации остатков
  // (пагинация full-снапшота, raw_items, catalog_match_queue,
  // pharmacy_api_keys + CHECK'и).
  '0015a_inventory_sync_extensions.sql',
  // EP-05, DTJ-142: enum `inventory_sync_row_error_code` +'processing_failed'
  // — отдельный файл, выполняется БЕЗ общей транзакции (SRS-DB-009/049).
  // `down.sql` отсутствует намеренно (IRREVERSIBLE).
  '0015b_inventory_sync_enum_extension.sql',
  // EP-05, DTJ-146: кэш однажды-сматченного для composite-матчинга.
  '0016_pharmacy_sku_mapping.sql',
]

export interface MigrationDescriptor {
  readonly name: string
  readonly upSql: string
  readonly downSql: string | null
}

export function listMigrations(): readonly MigrationDescriptor[] {
  return MIGRATION_FILES.map((name) => {
    const upPath = join(MIGRATIONS_DIR, name)
    const downPath = join(MIGRATIONS_DIR, name.replace(/\.sql$/u, '.down.sql'))
    const downSql = (() => {
      try {
        return readFileSync(downPath, 'utf8')
      } catch {
        return null
      }
    })()
    return {
      name,
      upSql: readFileSync(upPath, 'utf8'),
      downSql,
    }
  })
}
