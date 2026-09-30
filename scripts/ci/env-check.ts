/**
 * DTJ-426 — CI-гейт `pnpm env:check`.
 *
 * Сравнивает (а) множество имён переменных окружения, читаемых кодом через Zod-схемы
 * конфигурации (`ConfigModule.forRoot({ validate })` каждого Node-процесса монорепозитория —
 * на сегодня `apps/api` и `apps/worker`, см. `SCHEMA_MODULES` ниже), с (б) множеством имён,
 * перечисленных в корневом `.env.example`. Расхождение в ЛЮБУЮ сторону — ненулевой код выхода
 * (`SRS-NFR-054`).
 *
 * ASSUMPTION (AGENTS.md §10, задокументировано в отчёте о сдаче DTJ-426): гейт сверяет ТОЛЬКО
 * переменные, объявленные в канонических Zod-схемах (`envSchema.shape`) — это единственная
 * механически проверяемая граница контракта «код читает / документ обещает». Он сознательно НЕ
 * пытается свести воедино весь реестр `docs/spec/31-nfr-security-testing-devops.md`
 * §«Реестр переменных окружения» (`SRS-NFR-053`, ~70 переменных): часть из них уже читается
 * НАПРЯМУЮ через `process.env.*` в обход `ConfigModule`/`AppConfigService` (например
 * `JWT_PRIVATE_KEY` в `apps/api/src/modules/auth/infrastructure/adapters/rs256-jwt-signer.
 * adapter.ts`, DTJ-022/EP-01), а часть описывает ещё не реализованные в R1 подсистемы (S3,
 * WebSocket-таймауты, on-premise-лицензирование). Ни расширять `env.schema.ts` (файл этим
 * тикетом не владеется, `files_owned: [.env.example, scripts/env-check.ts]`), ни переписывать
 * доступ к ENV в чужих модулях — не входит в объём DTJ-426 (AGENTS.md §7). Список найденных
 * несоответствий SRS-NFR-053 vs реально читаемый код зафиксирован в отчёте о сдаче тикета
 * («НАЙДЕННЫЕ ЧУЖИЕ ПРОБЛЕМЫ»), не в этом файле.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { z } from 'zod'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
// `ENV_CHECK_REPO_ROOT_OVERRIDE` — ТОЛЬКО для `scripts/env-check.spec.ts` (негативные e2e-кейсы
// прогоняют этот CLI против временного фиктивного дерева, не против настоящего репозитория).
// В реальном запуске (`pnpm env:check`) переменная не задана — используется путь скрипта.
export const REPO_ROOT = process.env['ENV_CHECK_REPO_ROOT_OVERRIDE'] ?? path.resolve(SCRIPT_DIR, '..')
export const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example')

/** Каждый Node-процесс монорепозитория, валидирующий свой ENV через Zod на старте. */
export const SCHEMA_MODULES = [
  { app: 'apps/api', relativePath: 'apps/api/src/config/env.schema.ts' },
  { app: 'apps/worker', relativePath: 'apps/worker/src/config/env.schema.ts' },
] as const

interface ZodObjectLike {
  shape: Record<string, unknown>
}

/** Парсит `.env.example` построчно: имя ENV до `=`, комментарии (включая закомментированные
 * присвоения `# FOO=bar`) и пустые строки игнорируются — как того требует тест-план тикета. */
export function parseEnvExampleKeys(content: string): Set<string> {
  const keys = new Set<string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const eqIndex = line.indexOf('=')
    const key = (eqIndex === -1 ? line : line.slice(0, eqIndex)).trim()
    if (key.length > 0) {
      keys.add(key)
    }
  }
  return keys
}

export class SchemaNotFoundError extends Error {
  constructor(public readonly relativePath: string) {
    super(`схема конфигурации не найдена по ожидаемому пути: ${relativePath}`)
    this.name = 'SchemaNotFoundError'
  }
}

/** Рантайм-импорт схемы (ASSUMPTION тикета — проще и надёжнее статического AST-парсинга, риск
 * «Риски и подводные камни»). Схема ОБЯЗАНА быть модулем без побочных эффектов при импорте — тот
 * же контракт, что уже соблюдают `apps/api`/`apps/worker` `env.schema.ts` (никакого чтения
 * `process.env` на верхнем уровне модуля). */
export async function loadSchemaKeys(absolutePath: string, relativePathForError: string): Promise<Set<string>> {
  if (!existsSync(absolutePath)) {
    throw new SchemaNotFoundError(relativePathForError)
  }
  const moduleUrl = `${new URL(`file://${absolutePath}`).href}?t=${String(Date.now())}`
  const imported: unknown = await import(moduleUrl)
  const envSchema = (imported as { envSchema?: ZodObjectLike }).envSchema
  if (envSchema === undefined || typeof envSchema.shape !== 'object') {
    throw new Error(
      `модуль ${relativePathForError} не экспортирует \`envSchema\` (объект Zod с полем \`.shape\`) — проверьте контракт с DTJ-426`,
    )
  }
  return new Set(Object.keys(envSchema.shape))
}

export interface ComparisonResult {
  missingFromExample: string[]
  extraInExample: string[]
  isSynced: boolean
}

/** Чистая функция сравнения — не трогает файловую систему, легко тестируется. */
export function compareKeySets(schemaKeys: ReadonlySet<string>, exampleKeys: ReadonlySet<string>): ComparisonResult {
  const missingFromExample = [...schemaKeys].filter((key) => !exampleKeys.has(key)).sort()
  const extraInExample = [...exampleKeys].filter((key) => !schemaKeys.has(key)).sort()
  return { missingFromExample, extraInExample, isSynced: missingFromExample.length === 0 && extraInExample.length === 0 }
}

function formatReport(result: ComparisonResult): string {
  const lines: string[] = []
  if (result.missingFromExample.length > 0) {
    lines.push('Переменные, которые читает схема конфигурации, но которых НЕТ в .env.example (отсутствующие в примере):')
    lines.push(...result.missingFromExample.map((key) => `  - ${key}`))
  }
  if (result.extraInExample.length > 0) {
    lines.push('Переменные из .env.example, которые НИ ОДНА Zod-схема не читает (лишние в примере):')
    lines.push(...result.extraInExample.map((key) => `  - ${key}`))
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  if (!existsSync(ENV_EXAMPLE_PATH)) {
    console.error(`env:check: .env.example не найден по ожидаемому пути: ${ENV_EXAMPLE_PATH}`)
    process.exitCode = 1
    return
  }
  const exampleKeys = parseEnvExampleKeys(readFileSync(ENV_EXAMPLE_PATH, 'utf-8'))

  const schemaKeys = new Set<string>()
  for (const schemaModule of SCHEMA_MODULES) {
    const absolutePath = path.join(REPO_ROOT, schemaModule.relativePath)
    try {
      // eslint-disable-next-line no-await-in-loop -- последовательный импорт нескольких схем в
      // CLI-скрипте, не хот-путь рантайма — параллелизация не даёт измеримой выгоды здесь.
      const keys = await loadSchemaKeys(absolutePath, schemaModule.relativePath)
      for (const key of keys) {
        schemaKeys.add(key)
      }
    } catch (error) {
      if (error instanceof SchemaNotFoundError) {
        console.error(`env:check: ${error.message}`)
        console.error('(переходный период до появления схемы — см. DTJ-426 «Риски», AC4)')
        process.exitCode = 1
        return
      }
      throw error
    }
  }

  const result = compareKeySets(schemaKeys, exampleKeys)
  if (result.isSynced) {
    console.log(`env:check: OK — ${String(schemaKeys.size)} переменных, .env.example и Zod-схемы конфигурации полностью синхронны.`)
    return
  }
  console.error('env:check: РАСХОЖДЕНИЕ между .env.example и Zod-схемами конфигурации:\n')
  console.error(formatReport(result))
  process.exitCode = 1
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('env:check: непредвиденная ошибка:', error)
    process.exitCode = 1
  })
}
