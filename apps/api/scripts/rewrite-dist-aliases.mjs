#!/usr/bin/env node
/**
 * Постбилд-шаг: переписывает алиас `@/...` (tsconfig `paths`, работает только
 * при "moduleResolution": "Bundler"/typecheck) на относительный путь в
 * скомпилированном выводе `dist`.
 *
 * `tsc` (эту сборку запускает `nest build` без `--builder webpack`) НИКОГДА не
 * переписывает `paths`-алиасы в эмите — это задокументированное поведение, не
 * баг. В рантайме Node ESM резолвить `@/...` нечем (нет `"imports"` в
 * package.json, нет `tsc-alias`/`module-alias`), поэтому `node dist/main.js`
 * падает с `ERR_MODULE_NOT_FOUND`. Этот скрипт закрывает разрыв без установки
 * новых зависимостей: обходит `dist`, находит `@/X` в `.js`/`.d.ts` и заменяет
 * на относительный путь до файла с явным расширением `.js` (Node ESM требует
 * расширение в спецификаторе).
 *
 * Запускается из `package.json`: `"build": "... && node scripts/rewrite-dist-aliases.mjs"`.
 */

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const distRoot = join(scriptDir, '..', 'dist')

const ALIAS_PREFIX = '@/'

/** Рекурсивно собирает все .js и .d.ts файлы под `dir`. */
function collectFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...collectFiles(full))
    } else if (entry.endsWith('.js') || entry.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Приводит путь к POSIX-разделителям — Node ESM не резолвит '\\' в спецификаторах. */
function toPosix(p) {
  return p.split(sep).join('/')
}

/**
 * Резолвит алиас `@/rest/of/path[.js]` в существующий файл под `distRoot`
 * и возвращает его абсолютный путь. Учитывает три формы, которые встречаются
 * в эмите tsc: путь уже с `.js`, путь без расширения (файл), путь без
 * расширения на barrel/index-модуль.
 */
function resolveAliasTarget(aliasPath) {
  const rest = aliasPath.slice(ALIAS_PREFIX.length) // 'config/app-config.service.js' | 'modules/tenancy'
  const candidates = aliasPath.endsWith('.js')
    ? [join(distRoot, rest)]
    : [join(distRoot, `${rest}.js`), join(distRoot, rest, 'index.js')]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  // Не нашли на диске (например, файл ещё не эмитился в эту сборку из-за
  // ошибки в другом модуле) — лучшее приближение: путь с добавленным .js.
  return aliasPath.endsWith('.js') ? join(distRoot, rest) : join(distRoot, `${rest}.js`)
}

/** Заменяет один найденный алиас-спецификатор на относительный путь от `fileDir`. */
function toRelativeSpecifier(fileDir, aliasPath) {
  const target = resolveAliasTarget(aliasPath)
  let rel = toPosix(relative(fileDir, target))
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

// Порядок важен: сначала более специфичный `import(...)`/`import '...'`, чтобы
// не спутать с `from '...'`. Каждый паттерн захватывает кавычку и сам путь.
const PATTERNS = [
  // import(...) / import("...") — динамический импорт
  /(\bimport\s*\(\s*)(['"])(@\/[^'"]+)\2/g,
  // import '@/x' / import "@/x" — side-effect импорт (без from)
  /(\bimport\s+)(['"])(@\/[^'"]+)\2/g,
  // from '@/x' / from "@/x" — покрывает import ... from, export ... from, export * from
  /(\bfrom\s+)(['"])(@\/[^'"]+)\2/g,
]

function rewriteFile(filePath) {
  const original = readFileSync(filePath, 'utf8')
  if (!original.includes(ALIAS_PREFIX)) return false

  const fileDir = dirname(filePath)
  let content = original
  let changed = false

  for (const pattern of PATTERNS) {
    // Rest-параметр вместо (match, prefix, quote, aliasPath) — max-params считает rest
    // за один параметр; порядок групп regexp (см. PATTERNS выше) сохраняется через индексы.
    content = content.replace(pattern, (...groups) => {
      const [, prefix, quote, aliasPath] = groups
      changed = true
      const relSpecifier = toRelativeSpecifier(fileDir, aliasPath)
      return `${prefix}${quote}${relSpecifier}${quote}`
    })
  }

  if (changed) writeFileSync(filePath, content, 'utf8')
  return changed
}

function main() {
  if (!existsSync(distRoot)) {
    console.error(`[rewrite-dist-aliases] dist не найден: ${distRoot}`)
    process.exit(1)
  }

  const files = collectFiles(distRoot)
  let rewritten = 0
  for (const file of files) {
    if (rewriteFile(file)) rewritten++
  }

  console.log(`[rewrite-dist-aliases] проверено файлов: ${files.length}, переписано: ${rewritten}`)
}

main()
