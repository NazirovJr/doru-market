#!/usr/bin/env node
/**
 * docs:check — статическая проверка ссылок на документы и пути в коде (без сети и зависимостей).
 * (a) относительные markdown-ссылки указывают на существующие файлы;
 * (b) пути `docs|scripts|infra|tests|apps|packages/...` в не-markdown файлах существуют;
 * (c) AGENTS.md не длиннее MAX_AGENTS_LINES строк (пока предупреждение).
 * Ссылки внутри docs/history и tickets — история: битые дают предупреждение, а не ошибку.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_AGENTS_LINES = 150
const HISTORY_PREFIXES = ['docs/history/', 'tickets/']
// docs/api/openapi.json — генерируемый артефакт (`pnpm openapi:generate`), в репозитории его нет
export const GENERATED_ALLOWLIST = new Set(['docs/api/openapi.json'])
const IGNORED_PREFIXES = ['docs/product/design/claude-design-canvas/', 'node_modules/']
// спека содержит вымышленные пути как тестовые данные
const IGNORED_FILES = new Set(['pnpm-lock.yaml', 'scripts/ci/docs-check.spec.ts'])
const CODE_EXT = /\.(ts|tsx|js|jsx|cjs|mjs|json|yml|yaml|ps1|sh|sql|html|css|txt)$/
const PATH_LITERAL = /(?<![\w./\\@:-])((?:docs|scripts|infra|tests|apps|packages)\/[\w./-]+\.(?:md|ts|json|yml|ps1|sh|txt))(?![\w-])/g

const toPosix = (p) => p.split(path.sep).join('/')
const isHistory = (file) => HISTORY_PREFIXES.some((p) => file.startsWith(p))

export function listTrackedFiles(root) {
  const out = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
  return out.split('\0').filter(Boolean)
}

// Вырезает fenced-блоки и inline-код, сохраняя переводы строк: примеры ссылок в коде — не ссылки.
function stripCode(text) {
  return text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

export function extractMarkdownLinks(text) {
  const links = []
  const clean = stripCode(text)
  const inline = /\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g
  const refDef = /^[ ]{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm
  for (const re of [inline, refDef]) {
    for (const m of clean.matchAll(re)) {
      const line = clean.slice(0, m.index).split('\n').length
      links.push({ target: m[1].replace(/^<|>$/g, ''), line })
    }
  }
  return links
}

export function resolveLinkTarget(root, file, target) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/|\/)/i.test(target)) return null
  const bare = target.split('#')[0].split('?')[0]
  if (!bare) return null
  let decoded = bare
  try {
    decoded = decodeURI(bare)
  } catch {
    // не URI-кодированный путь — берём как есть
  }
  return toPosix(path.relative(root, path.resolve(root, path.dirname(file), decoded)))
}

export function checkMarkdownLinks(root, files) {
  const errors = []
  const warnings = []
  for (const file of files.filter((f) => f.endsWith('.md') && !IGNORED_PREFIXES.some((p) => f.startsWith(p)))) {
    const text = readFileSync(path.join(root, file), 'utf8')
    for (const { target, line } of extractMarkdownLinks(text)) {
      const resolved = resolveLinkTarget(root, file, target)
      if (resolved === null || existsSync(path.join(root, resolved))) continue
      const msg = `${file}:${line}: битая ссылка на ${target} (нет ${resolved})`
      ;(isHistory(file) ? warnings : errors).push(msg)
    }
  }
  return { errors, warnings }
}

export function checkPathLiterals(root, files) {
  const errors = []
  const warnings = []
  for (const file of files) {
    if (file.endsWith('.md') || !CODE_EXT.test(file) || IGNORED_FILES.has(file)) continue
    if (IGNORED_PREFIXES.some((p) => file.startsWith(p))) continue
    const text = readFileSync(path.join(root, file), 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(PATH_LITERAL)) {
        const p = m[1]
        if (p.includes('...')) continue // сокращение вида apps/api/.../file.ts
        if (GENERATED_ALLOWLIST.has(p) || existsSync(path.join(root, p))) continue
        errors.push(`${file}:${i + 1}: путь ${p} не существует`)
      }
    }
  }
  return { errors, warnings }
}

export function checkAgentsLength(root, files) {
  if (!files.includes('AGENTS.md')) return { errors: [], warnings: [] }
  const lines = readFileSync(path.join(root, 'AGENTS.md'), 'utf8').split('\n').length
  const warnings = lines > MAX_AGENTS_LINES ? [`AGENTS.md: ${lines} строк, лимит ${MAX_AGENTS_LINES}`] : []
  return { errors: [], warnings }
}

export function runDocsCheck(root, files = listTrackedFiles(root)) {
  const parts = [checkMarkdownLinks(root, files), checkPathLiterals(root, files), checkAgentsLength(root, files)]
  return { errors: parts.flatMap((p) => p.errors), warnings: parts.flatMap((p) => p.warnings) }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const { errors, warnings } = runDocsCheck(root)
  const byTop = new Map()
  for (const w of warnings) {
    const top = w.split(':')[0].split('/').slice(0, 2).join('/')
    byTop.set(top, (byTop.get(top) ?? 0) + 1)
  }
  for (const [top, n] of [...byTop].sort()) console.warn(`warning: ${top} — ${n}`)
  if (process.argv.includes('--verbose')) warnings.forEach((w) => console.warn(`warning: ${w}`))
  errors.forEach((e) => console.error(`error: ${e}`))
  console.log(`docs:check — ошибок: ${errors.length}, предупреждений: ${warnings.length}`)
  process.exit(errors.length > 0 ? 1 : 0)
}
