/**
 * DTJ-426 — тесты `scripts/env-check.ts` (тест-план тикета, все 5 пунктов дословно).
 *
 * Юнит-часть проверяет чистые функции (`parseEnvExampleKeys`, `compareKeySets`, `loadSchemaKeys`)
 * напрямую. Секция «негативный прогон» запускает САМ CLI-скрипт как подпроцесс против временного
 * фиктивного дерева (через `ENV_CHECK_REPO_ROOT_OVERRIDE`), чтобы доказать живым прогоном
 * ненулевой код выхода при расхождении — не только логику функции, которую он вызывает.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { compareKeySets, loadSchemaKeys, parseEnvExampleKeys, SchemaNotFoundError } from './env-check.js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const ENV_CHECK_SCRIPT = path.join(SCRIPT_DIR, 'env-check.ts')
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx')

describe('parseEnvExampleKeys', () => {
  it('парсит имена ключей, игнорируя комментарии и пустые строки', () => {
    const content = [
      '# заголовок категории',
      '',
      'NODE_ENV=development',
      '  # закомментированное присвоение не считается ключом',
      '# ALIF_MOBI_API_TOKEN=',
      'PORT=3000',
      '',
      'EMPTY_VALUE_KEY=',
    ].join('\n')

    const keys = parseEnvExampleKeys(content)

    expect(keys).toEqual(new Set(['NODE_ENV', 'PORT', 'EMPTY_VALUE_KEY']))
    expect(keys.has('ALIF_MOBI_API_TOKEN')).toBe(false)
  })
})

describe('compareKeySets', () => {
  it('обнаруживает переменную, которую схема объявляет, но которой нет в .env.example', () => {
    const result = compareKeySets(new Set(['FOO', 'BAZ_QUX']), new Set(['FOO']))
    expect(result.isSynced).toBe(false)
    expect(result.missingFromExample).toEqual(['BAZ_QUX'])
    expect(result.extraInExample).toEqual([])
  })

  it('обнаруживает переменную из .env.example, которую ни одна схема не читает', () => {
    const result = compareKeySets(new Set(['FOO']), new Set(['FOO', 'FOO_BAR']))
    expect(result.isSynced).toBe(false)
    expect(result.extraInExample).toEqual(['FOO_BAR'])
    expect(result.missingFromExample).toEqual([])
  })

  it('возвращает isSynced=true, когда оба множества совпадают', () => {
    const result = compareKeySets(new Set(['FOO', 'BAR']), new Set(['BAR', 'FOO']))
    expect(result.isSynced).toBe(true)
    expect(result.missingFromExample).toEqual([])
    expect(result.extraInExample).toEqual([])
  })
})

describe('loadSchemaKeys', () => {
  it('читает envSchema.shape реальной фикстуры и возвращает множество имён ключей', async () => {
    const fixturePath = path.join(SCRIPT_DIR, '__fixtures__', 'valid-schema.fixture.ts')
    const keys = await loadSchemaKeys(fixturePath, 'scripts/__fixtures__/valid-schema.fixture.ts')
    expect(keys).toEqual(new Set(['FOO', 'BAR', 'BAZ_QUX']))
  })

  it('AC4: отсутствующий файл схемы — понятная ошибка SchemaNotFoundError, не stack trace', async () => {
    const missingPath = path.join(SCRIPT_DIR, '__fixtures__', 'does-not-exist.fixture.ts')
    await expect(loadSchemaKeys(missingPath, 'apps/api/src/config/env.schema.ts')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SchemaNotFoundError)
      expect((error as SchemaNotFoundError).message).toBe(
        'схема конфигурации не найдена по ожидаемому пути: apps/api/src/config/env.schema.ts',
      )
      return true
    })
  })

  it('модуль существует, но не экспортирует envSchema — явная ошибка контракта', async () => {
    const fixturePath = path.join(SCRIPT_DIR, '__fixtures__', 'no-export-schema.fixture.ts')
    await expect(loadSchemaKeys(fixturePath, 'scripts/__fixtures__/no-export-schema.fixture.ts')).rejects.toThrow(
      /не экспортирует `envSchema`/,
    )
  })
})

describe('env-check.ts — CLI (негативный e2e-прогон против фиктивного дерева)', () => {
  let tmpRoot: string

  afterEach(() => {
    if (tmpRoot.length > 0) {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  /** Собирает минимальное фиктивное дерево apps/api + apps/worker envSchema-модулей + корневой
   * .env.example и возвращает результат запуска настоящего `scripts/env-check.ts` против него. */
  function runCliAgainstFixtureTree(envExampleContent: string): { status: number | null; stdout: string; stderr: string } {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'dtj-426-env-check-'))
    for (const app of ['apps/api', 'apps/worker']) {
      mkdirSync(path.join(tmpRoot, app, 'src', 'config'), { recursive: true })
      writeFileSync(
        path.join(tmpRoot, app, 'src', 'config', 'env.schema.ts'),
        "export const envSchema = { shape: { FOO_BAR: {}, DATABASE_URL: {} } }\n",
      )
    }
    writeFileSync(path.join(tmpRoot, '.env.example'), envExampleContent)

    const result = spawnSync(TSX_BIN, [ENV_CHECK_SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, ENV_CHECK_REPO_ROOT_OVERRIDE: tmpRoot },
      encoding: 'utf-8',
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  it('AC3: полностью синхронные множества — код выхода 0, вывод подтверждает синхронность', () => {
    const { status, stdout } = runCliAgainstFixtureTree('FOO_BAR=x\nDATABASE_URL=postgres://x\n')
    expect(status).toBe(0)
    expect(stdout).toMatch(/OK/)
  })

  it('негативный прогон: удаление переменной из .env.example роняет гейт (AC2)', () => {
    // DATABASE_URL объявлена схемой (apps/api и apps/worker), но отсутствует в .env.example.
    const { status, stderr } = runCliAgainstFixtureTree('FOO_BAR=x\n')
    expect(status).not.toBe(0)
    expect(stderr).toMatch(/DATABASE_URL/)
    expect(stderr).toMatch(/отсутствующие в примере/)
  })

  it('AC1: лишняя переменная в .env.example, которую схема не читает, роняет гейт', () => {
    const { status, stderr } = runCliAgainstFixtureTree('FOO_BAR=x\nDATABASE_URL=postgres://x\nFOO_BAR_EXTRA=y\n')
    expect(status).not.toBe(0)
    expect(stderr).toMatch(/FOO_BAR_EXTRA/)
    expect(stderr).toMatch(/лишние в примере/)
  })
})
