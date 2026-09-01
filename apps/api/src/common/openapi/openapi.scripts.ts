/**
 * `openapi.scripts.ts` (EP-01, DTJ-021, SRS-API-062) — утилиты CLI:
 *
 *   - `generate()`: `pnpm openapi:generate` — пишет `docs/api/openapi.json` в
 *     корне репозитория. Идемпотентен (всегда перезаписывает).
 *
 *   - `check()`: `pnpm openapi:check` — генерирует во временный файл и
 *     сравнивает с закоммиченным `docs/api/openapi.json`. Ненулевой код
 *     выхода при расхождении (CI-часть, см. JSDoc DTJ-021).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildOpenApiDocument } from './openapi.builder.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'api', 'openapi.json')

const USAGE = `Usage: tsx openapi.scripts.ts [generate|check]`

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
}

async function generate(): Promise<void> {
  const doc = buildOpenApiDocument()
  const json = JSON.stringify(doc, null, 2)
  await ensureDir(OUTPUT_PATH)
  await writeFile(OUTPUT_PATH, json, 'utf-8')
  // eslint-disable-next-line no-console -- CLI-скрипт (`*.scripts.ts` не входит в Nest-приложение), console — единственный канал вывода для пользователя скрипта.
  console.log(`[openapi:generate] wrote ${OUTPUT_PATH} (${json.length} bytes)`)
}

async function check(): Promise<void> {
  const doc = buildOpenApiDocument()
  const generated = JSON.stringify(doc, null, 2)
  let committed: string
  try {
    committed = await readFile(OUTPUT_PATH, 'utf-8')
  } catch {
    // eslint-disable-next-line no-console -- CLI-скрипт (`*.scripts.ts` не входит в Nest-приложение), console — единственный канал вывода для пользователя скрипта.
    console.error(`[openapi:check] committed file not found: ${OUTPUT_PATH}`)
    process.exit(1)
  }
  if (generated === committed) {
    // eslint-disable-next-line no-console -- CLI-скрипт (`*.scripts.ts` не входит в Nest-приложение), console — единственный канал вывода для пользователя скрипта.
    console.log('[openapi:check] OK — committed spec matches generated')
    return
  }
  // eslint-disable-next-line no-console -- CLI-скрипт (`*.scripts.ts` не входит в Nest-приложение), console — единственный канал вывода для пользователя скрипта.
  console.error('[openapi:check] MISMATCH — run `pnpm openapi:generate` and commit the diff')
  process.exit(1)
}

const command = process.argv[2]
switch (command) {
  case 'generate':
    void generate().catch((err: unknown) => {
      // eslint-disable-next-line no-console -- CLI-скрипт (`*.scripts.ts` не входит в Nest-приложение), console — единственный канал вывода для пользователя скрипта.
      console.error('[openapi:generate] failed', err)
      process.exit(1)
    })
    break
  case 'check':
    void check().catch((err: unknown) => {
      // eslint-disable-next-line no-console -- CLI-скрипт (`*.scripts.ts` не входит в Nest-приложение), console — единственный канал вывода для пользователя скрипта.
      console.error('[openapi:check] failed', err)
      process.exit(1)
    })
    break
  default:
    // eslint-disable-next-line no-console -- CLI-скрипт (`*.scripts.ts` не входит в Nest-приложение), console — единственный канал вывода для пользователя скрипта.
    console.error(USAGE)
    process.exit(2)
}
