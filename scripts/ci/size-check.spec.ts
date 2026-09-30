/**
 * DTJ-427 — тесты `scripts/ci/size-check.ts` (тест-план тикета, 5 пунктов).
 * Синтетический манифест сборки — фикстура `__fixtures__/size-check/manifest.json` (моделирует
 * AC3: лениво загружаемый `admin/branding` НЕ должен попасть в критический путь).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectCriticalChunkKeys,
  computeChunkSizes,
  evaluateBudget,
  findEntryChunkKey,
  MAX_FIRST_SCREEN_BUNDLE_BYTES,
  readManifest,
  runSizeCheck,
} from './size-check.js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIST_DIR = path.join(SCRIPT_DIR, '__fixtures__', 'size-check')
const FIXTURE_MANIFEST_PATH = path.join(FIXTURE_DIST_DIR, 'manifest.json')

describe('sums only first-screen critical chunks, excludes lazily-loaded route chunks (AC3)', () => {
  it('bfs по entry+route не заходит в dynamicImports (admin/branding, 500KB)', () => {
    const manifest = readManifest(FIXTURE_MANIFEST_PATH)
    const entryKey = findEntryChunkKey(manifest)
    const keys = collectCriticalChunkKeys(manifest, entryKey, 'src/pages/home/home-page.tsx')

    expect(keys.has('src/pages/admin/branding-page.tsx')).toBe(false)
    expect(keys.has('src/pages/home/home-page.tsx')).toBe(true)
    expect(keys.has('_shared-vendor.js')).toBe(true)
  })
})

describe('excludes font and image assets from the byte count (AC4)', () => {
  it('файл .woff2, реально импортируемый маршрутом, вносит 0 байт', () => {
    const manifest = readManifest(FIXTURE_MANIFEST_PATH)
    const entryKey = findEntryChunkKey(manifest)
    const keys = collectCriticalChunkKeys(manifest, entryKey, 'src/pages/home/home-page.tsx')

    const entries = computeChunkSizes(FIXTURE_DIST_DIR, manifest, keys)
    const font = entries.find((e) => e.file.endsWith('.woff2'))

    expect(font?.excludedAsset).toBe(true)
    expect(font?.gzipBytes).toBe(0)
  })
})

describe('evaluateBudget — margin/overage arithmetic (AC1/AC2)', () => {
  it('passes when total is under threshold, with correct remaining margin reported', () => {
    const result = evaluateBudget([{ key: 'a', file: 'a.js', gzipBytes: 240 * 1024, excludedAsset: false }])
    expect(result.isWithinBudget).toBe(true)
    expect(result.budgetBytes - result.totalGzipBytes).toBe(10 * 1024)
  })

  it('fails with non-zero exit code and readable overage report when threshold exceeded', () => {
    const result = evaluateBudget([{ key: 'a', file: 'a.js', gzipBytes: 260 * 1024, excludedAsset: false }])
    expect(result.isWithinBudget).toBe(false)
    expect(result.totalGzipBytes - result.budgetBytes).toBe(10 * 1024)
  })
})

describe('MAX_FIRST_SCREEN_BUNDLE_BYTES is a named constant, not a magic literal', () => {
  it('исходник объявляет и использует именованную константу, а не инлайновое число 256000', () => {
    expect(MAX_FIRST_SCREEN_BUNDLE_BYTES).toBe(250 * 1024)
    const source = readFileSync(path.join(SCRIPT_DIR, 'size-check.ts'), 'utf-8')
    expect(source).toMatch(/export const MAX_FIRST_SCREEN_BUNDLE_BYTES = 250 \* 1024/)
    expect(source).not.toMatch(/256000/)
  })
})

describe('runSizeCheck — сквозной прогон против реальных gzip-байт файлов на диске', () => {
  let tmpRoot: string

  afterEach(() => {
    if (tmpRoot.length > 0) rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('считает реальный gzip-размер чанка с диска, не выдуманное число', () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'dtj-427-size-check-'))
    mkdirSync(path.join(tmpRoot, 'dist', '.vite'), { recursive: true })
    mkdirSync(path.join(tmpRoot, 'dist', 'assets'), { recursive: true })

    const entryContent = randomBytes(2048)
    writeFileSync(path.join(tmpRoot, 'dist', 'assets', 'entry.js'), entryContent)
    writeFileSync(
      path.join(tmpRoot, 'dist', '.vite', 'manifest.json'),
      JSON.stringify({
        'index.html': { file: 'assets/entry.js', isEntry: true, dynamicImports: ['src/pages/home/home-page.tsx'] },
        'src/pages/home/home-page.tsx': { file: 'assets/entry.js', imports: ['index.html'] },
      }),
    )
    writeFileSync(
      path.join(tmpRoot, 'size-check.config.json'),
      JSON.stringify({ distDir: 'dist', firstScreenRoute: 'src/pages/home/home-page.tsx' }),
    )

    const result = runSizeCheck(tmpRoot)

    expect(result.totalGzipBytes).toBe(gzipSync(entryContent).length)
  })
})
