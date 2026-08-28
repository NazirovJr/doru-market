// DTJ-415: «ловушка, которая перестала ловить, молчит об этом — ловушку нужно проверять
// ловушкой» (docs/02-CLEAN-ARCHITECTURE-AND-CODE.md §6.1). Этот файл программно прогоняет
// ESLint и dependency-cruiser ПРОТИВ каждой фикстуры-нарушителя из tests/arch/fixtures/** и
// утверждает, что инструмент её отвергает (ненулевой код возврата + ожидаемый фрагмент
// сообщения). Если хотя бы один кейс здесь позеленеет — конфигурация архитектурных правил
// молча ослабла, и это баг конфигурации, а не повод удалять фикстуру или тест (см. README.md).
//
// Фикстуры физически исключены из общего `pnpm lint`/`pnpm verify` (см.
// eslint.config.mjs → ignores → 'tests/arch/fixtures/**') и из `pnpm arch:check`
// (arch:check таргетирует только `apps packages`, tests/ туда не входит). Здесь мы обходим
// это исключение намеренно: ESLint — флагом `--no-ignore`, dependency-cruiser — тем, что
// `arch:check` его вообще не касается, мы просто запускаем depcruise отдельно с целью на
// папку фикстуры.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(__dirname, '../..')
const DEPENDENCY_CRUISER_CONFIG = path.join(REPO_ROOT, '.dependency-cruiser.cjs')

/** Абсолютный путь к CLI-скрипту пакета — без `pnpm exec`/PATH, напрямую через `node`. */
function resolveBin(pkgName: string, binKey: string): string {
  const pkgJsonPath = path.join(REPO_ROOT, 'node_modules', pkgName, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
    bin: string | Record<string, string>
  }
  const relativeBin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[binKey]
  if (relativeBin === undefined) {
    throw new Error(`Пакет ${pkgName} не объявляет bin "${binKey}" в package.json`)
  }
  return path.join(path.dirname(pkgJsonPath), relativeBin)
}

const ESLINT_BIN = resolveBin('eslint', 'eslint')
const DEPCRUISE_BIN = resolveBin('dependency-cruiser', 'depcruise')

interface ProcessResult {
  readonly exitCode: number
  readonly output: string
}

function runEslint(targets: readonly string[]): ProcessResult {
  const result = spawnSync(process.execPath, [ESLINT_BIN, '--no-ignore', ...targets], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
  return { exitCode: result.status ?? 1, output: `${result.stdout}\n${result.stderr}` }
}

/** severity=error у dependency-cruiser печатает полный `comment` из правила только в err-long. */
function runDepcruise(cwd: string, targets: readonly string[]): ProcessResult {
  const args = [DEPCRUISE_BIN, '--config', DEPENDENCY_CRUISER_CONFIG, '--output-type', 'err-long', ...targets]
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf-8' })
  return { exitCode: result.status ?? 1, output: `${result.stdout}\n${result.stderr}` }
}

const FIXTURES_DIR = path.join(REPO_ROOT, 'tests/arch/fixtures')

/**
 * Каждый кейс запускает ДОЧЕРНИЙ процесс (ESLint или dependency-cruiser) с полным разбором
 * графа импортов — это 5-10 секунд на кейс. Дефолтный таймаут vitest (5 с) их рубит, и тест
 * падает не потому, что защита ослабла, а потому что не успел. Поднимаем явно.
 */
const PROCESS_SPAWN_TIMEOUT_MS = 120_000

describe('tests/arch/fixtures — каждый нарушитель должен ловиться', () => {
  // ─── 1. domain/ импортирует drizzle-orm → ESLint no-restricted-imports ───
  it(
    'domain-imports-drizzle: ловится ESLint (no-restricted-imports, §1.1)',
    () => {
      const result = runEslint(['tests/arch/fixtures/domain-imports-drizzle/domain/order.entity.ts'])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('Слой domain обязан быть чистым')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )

  // ─── 2. Date.now() в domain/ → ESLint no-restricted-globals + no-restricted-properties ───
  it(
    'domain-uses-date-now: ловится ESLint (no-restricted-globals + no-restricted-properties, §2.6)',
    () => {
      const result = runEslint(['tests/arch/fixtures/domain-uses-date-now/domain/otp.entity.ts'])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('В domain время берётся через порт Clock')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )

  // ─── 3. Магическое число 7919 → ESLint @typescript-eslint/no-magic-numbers (C6) ───
  it(
    'magic-number: ловится ESLint (@typescript-eslint/no-magic-numbers, C6)',
    () => {
      const result = runEslint(['tests/arch/fixtures/magic-number/pricing.ts'])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('No magic number: 7919')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )

  // ─── 4a. application/ импортирует infrastructure/ → ESLint no-restricted-imports ───
  it(
    'application-imports-infrastructure: ловится ESLint (no-restricted-imports, §1.1)',
    () => {
      const result = runEslint([
        'tests/arch/fixtures/application-imports-infrastructure/application/place-order.use-case.ts',
      ])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('application зависит только от domain и собственных портов')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )

  // ─── 4b. Тот же фикстура, но по графу зависимостей → dependency-cruiser (§6.1 таблица: "обоими") ───
  it(
    'application-imports-infrastructure: ловится dependency-cruiser (application-does-not-know-infrastructure)',
    () => {
      const result = runDepcruise(REPO_ROOT, ['tests/arch/fixtures/application-imports-infrastructure'])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('application-does-not-know-infrastructure')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )

  // ─── 5. Глубокий импорт orders/domain в обход фасада payments → dependency-cruiser ───
  // Правило `no-cross-module-deep-import` заякорено на `^apps/(api|worker)/src/modules/...`,
  // поэтому фикстура физически вложена в apps/api/src/modules/... ВНУТРИ своей папки, а
  // depcruise запускается с cwd = сама папка фикстуры, чтобы относительный путь совпал с якорем.
  it(
    'cross-module-deep-import: ловится dependency-cruiser (no-cross-module-deep-import, §1.2)',
    () => {
      const cwd = path.join(FIXTURES_DIR, 'cross-module-deep-import')
      const result = runDepcruise(cwd, ['apps'])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('Межмодульное взаимодействие — ТОЛЬКО через публичный фасад')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )

  // ─── 6. Горизонтальный импорт feature-a → feature-b → dependency-cruiser ───
  // Правило `fe-features-are-isolated` тоже заякорено на `^apps/[^/]+/src/features/...` — та же
  // техника cwd, что и в п.5.
  it(
    'frontend-horizontal-feature-import: ловится dependency-cruiser (fe-features-are-isolated, §5)',
    () => {
      const cwd = path.join(FIXTURES_DIR, 'frontend-horizontal-feature-import')
      const result = runDepcruise(cwd, ['apps'])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('Горизонтальные импорты между фичами запрещены')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )

  // ─── Smoke: все ESLint-фикстуры одним batch-вызовом — ни одна не пропущена молча ───
  it(
    'smoke (ESLint batch): все 4 ESLint-фикстуры разом всё ещё ловятся вместе',
    () => {
      const result = runEslint([
        'tests/arch/fixtures/domain-imports-drizzle/domain/order.entity.ts',
        'tests/arch/fixtures/domain-uses-date-now/domain/otp.entity.ts',
        'tests/arch/fixtures/magic-number/pricing.ts',
        'tests/arch/fixtures/application-imports-infrastructure/application/place-order.use-case.ts',
      ])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('Слой domain обязан быть чистым')
      expect(result.output).toContain('В domain время берётся через порт Clock')
      expect(result.output).toContain('No magic number: 7919')
      expect(result.output).toContain('application зависит только от domain и собственных портов')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )

  // ─── Smoke: dependency-cruiser над всей папкой fixtures разом — ни одна не пропущена молча ───
  // Якорные правила (п.5, п.6) в этом batch-вызове не сработают (cwd=REPO_ROOT ломает якорь
  // `^apps/...`) — они уже отдельно проверены выше с правильным cwd. Здесь цель — доказать,
  // что depcruise в принципе не игнорирует файлы вне явно перечисленного набора при
  // директорийном (не поштучном) вызове.
  it(
    'smoke (dependency-cruiser batch): скан всей папки fixtures разом всё ещё ловит нарушения',
    () => {
      const result = runDepcruise(REPO_ROOT, ['tests/arch/fixtures'])

      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain('application-does-not-know-infrastructure')
    },
    PROCESS_SPAWN_TIMEOUT_MS,
  )
})
