/**
 * DTJ-427 — CI-гейт `pnpm size-check`: бюджет ≤250KB gzip для JS/CSS первого экрана.
 * Критический путь = entry-чанк (`isEntry`) + чанк маршрута `firstScreenRoute` из конфига
 * приложения, дальше только по СТАТИЧЕСКИМ `imports` (не `dynamicImports` — иначе в бюджет
 * попали бы все ленивые роуты, что и должен ловить AC3).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const MAX_FIRST_SCREEN_BUNDLE_BYTES = 250 * 1024

const EXCLUDED_ASSET_EXTENSIONS = new Set(['.woff', '.woff2', '.png', '.jpg', '.jpeg', '.webp', '.svg'])

interface ManifestChunk {
  file: string
  isEntry?: boolean
  imports?: string[]
  css?: string[]
}
type Manifest = Record<string, ManifestChunk>

export interface SizeCheckConfig {
  distDir: string
  firstScreenRoute: string
}

export class ManifestNotFoundError extends Error {
  constructor(public readonly manifestPath: string) {
    super(`манифест сборки не найден: ${manifestPath} (нужен build.manifest: true и \`vite build\` перед size-check)`)
    this.name = 'ManifestNotFoundError'
  }
}
export class EntryChunkNotFoundError extends Error {
  constructor() {
    super('в манифесте нет чанка с isEntry: true')
    this.name = 'EntryChunkNotFoundError'
  }
}
export class RouteChunkNotFoundError extends Error {
  constructor(public readonly routeKey: string) {
    super(`firstScreenRoute "${routeKey}" отсутствует в манифесте сборки`)
    this.name = 'RouteChunkNotFoundError'
  }
}

export function readManifest(manifestPath: string): Manifest {
  if (!existsSync(manifestPath)) {
    throw new ManifestNotFoundError(manifestPath)
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest
}

export function findEntryChunkKey(manifest: Manifest): string {
  const entry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry === true)
  if (entry === undefined) {
    throw new EntryChunkNotFoundError()
  }
  return entry[0]
}

/** Собирает ключи чанков, реально нужных ДО интерактивности: entry + маршрут `/` + всё, что они
 * статически импортируют (рекурсивно). `dynamicImports` игнорируется намеренно — это ленивые
 * маршруты соседних фич (`checkout`, `admin` и т.п.), они не должны попадать в бюджет. */
export function collectCriticalChunkKeys(manifest: Manifest, entryKey: string, routeKey: string): Set<string> {
  const visited = new Set([entryKey, routeKey])
  const queue = [entryKey, routeKey]
  let next = queue.shift()
  while (next !== undefined) {
    const chunk = manifest[next]
    for (const importedKey of chunk?.imports ?? []) {
      if (importedKey !== entryKey && !visited.has(importedKey)) {
        visited.add(importedKey)
        queue.push(importedKey)
      }
    }
    next = queue.shift()
  }
  return visited
}

export interface ChunkSizeEntry {
  key: string
  file: string
  gzipBytes: number
  excludedAsset: boolean
}

/** Файлы шрифтов/изображений исключаются из подсчёта (AC4) — инлайн-SVG внутри JS-чанка сюда не
 * попадает отдельной записью, он уже часть веса самого `.js`-файла. */
export function computeChunkSizes(distDir: string, manifest: Manifest, chunkKeys: ReadonlySet<string>): ChunkSizeEntry[] {
  const files = new Map<string, string>()
  for (const key of chunkKeys) {
    const chunk = manifest[key]
    if (chunk === undefined) continue
    if (!files.has(chunk.file)) files.set(chunk.file, key)
    for (const cssFile of chunk.css ?? []) {
      if (!files.has(cssFile)) files.set(cssFile, key)
    }
  }
  return [...files].map(([file, key]) => {
    const excludedAsset = EXCLUDED_ASSET_EXTENSIONS.has(path.extname(file).toLowerCase())
    const gzipBytes = excludedAsset ? 0 : gzipSync(readFileSync(path.join(distDir, file))).length
    return { key, file, gzipBytes, excludedAsset }
  })
}

export interface SizeCheckResult {
  totalGzipBytes: number
  budgetBytes: number
  entries: ChunkSizeEntry[]
  isWithinBudget: boolean
}

export function evaluateBudget(entries: readonly ChunkSizeEntry[], budgetBytes = MAX_FIRST_SCREEN_BUNDLE_BYTES): SizeCheckResult {
  const totalGzipBytes = entries.filter((e) => !e.excludedAsset).reduce((sum, e) => sum + e.gzipBytes, 0)
  return {
    totalGzipBytes,
    budgetBytes,
    entries: [...entries].sort((a, b) => b.gzipBytes - a.gzipBytes),
    isWithinBudget: totalGzipBytes <= budgetBytes,
  }
}

export function readConfig(appDir: string): SizeCheckConfig {
  const configPath = path.join(appDir, 'size-check.config.json')
  if (!existsSync(configPath)) {
    throw new Error(`size-check.config.json не найден: ${configPath}`)
  }
  return JSON.parse(readFileSync(configPath, 'utf-8')) as SizeCheckConfig
}

export function runSizeCheck(appDir: string): SizeCheckResult {
  const config = readConfig(appDir)
  const distDir = path.join(appDir, config.distDir)
  const manifest = readManifest(path.join(distDir, '.vite', 'manifest.json'))
  const entryKey = findEntryChunkKey(manifest)
  if (manifest[config.firstScreenRoute] === undefined) {
    throw new RouteChunkNotFoundError(config.firstScreenRoute)
  }
  const chunkKeys = collectCriticalChunkKeys(manifest, entryKey, config.firstScreenRoute)
  const entries = computeChunkSizes(distDir, manifest, chunkKeys)
  return evaluateBudget(entries)
}

const toKb = (bytes: number): string => (bytes / 1024).toFixed(1)

export function formatReport(result: SizeCheckResult): string {
  const lines = [
    `size-check: ${toKb(result.totalGzipBytes)}KB / ${toKb(result.budgetBytes)}KB gzip`,
    result.isWithinBudget
      ? `запас ${toKb(result.budgetBytes - result.totalGzipBytes)}KB`
      : `ПРЕВЫШЕНИЕ на ${toKb(result.totalGzipBytes - result.budgetBytes)}KB`,
    'учтённые чанки (по убыванию размера):',
    ...result.entries.map((e) => `  - ${e.file}: ${e.excludedAsset ? 'исключён (шрифт/изображение)' : `${toKb(e.gzipBytes)}KB`}`),
  ]
  return lines.join('\n')
}

async function main(): Promise<void> {
  const appDir = path.resolve(process.argv[2] ?? '.')
  const result = runSizeCheck(appDir)
  const report = formatReport(result)
  if (result.isWithinBudget) {
    console.log(report)
    return
  }
  console.error(report)
  process.exitCode = 1
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('size-check: непредвиденная ошибка:', error)
    process.exitCode = 1
  })
}
