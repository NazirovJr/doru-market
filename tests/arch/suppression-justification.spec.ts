/**
 * `suppression-justification.spec.ts` (Блок 5.4 задача STATE-AND-RESUME-POINT.md §11.4) —
 * машинно-проверяемое правило подавлений ESLint.
 *
 * Правило: каждый `eslint-disable*` ДОЛЖЕН иметь обоснование после `--` на той же строке.
 * Если подавление не подавляет ничего полезного — оно протухло (refactor оставил закомментированный
 * обход) и должно быть удалено. Если подавление всё ещё нужно — за ним должна быть причина,
 * отличающая «правило объективно неприменимо» от «правило нашло настоящую проблему, которую
 * мы решили не решать».
 *
 * Исключения из скана:
 *   - `tests/arch/fixtures/**` (там нарушения намеренные, тестируют ловушки)
 *   - сгенерированный код (`.gen.ts`, `drizzle/`, `dist/`, `build/`, `coverage/`)
 *
 * Тест ОБЯЗАН выводить список файлов-нарушителей (а не просто молча падать), чтобы
 * ревьюер мог сразу увидеть, что именно нужно исправить.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 5.4
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

/** Все `eslint-disable*` директивы (next-line, file, line), с информацией о позиции. */
interface Suppression {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly hasJustification: boolean
}

const SCAN_DIRS = ['apps', 'packages'] as const
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx'])

const EXCLUDED_PATH_FRAGMENTS = [
  `${sep}node_modules${sep}`,
  `${sep}dist${sep}`,
  `${sep}build${sep}`,
  `${sep}coverage${sep}`,
  `${sep}.turbo${sep}`,
  `${sep}drizzle${sep}`,
  `${sep}tests${sep}arch${sep}fixtures${sep}`,
] as const

/** Слабый «justification» — текст после `--` отделён пробелами, не пустой. */
const JUSTIFICATION_PATTERN = / -- \S/

/** Сами директивы — все варианты. */
const SUPPRESSION_PATTERN = /eslint-disable(?:-next-line|-file)?(?:\s+[A-Za-z@/_-][\w@/_-]*)+/

function shouldSkip(path: string): boolean {
  return EXCLUDED_PATH_FRAGMENTS.some((fragment) => path.includes(fragment))
}

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      yield* walk(full)
    } else if (stat.isFile()) {
      const lastDot = entry.lastIndexOf('.')
      const ext = lastDot >= 0 ? entry.slice(lastDot) : ''
      if (SCAN_EXTENSIONS.has(ext)) {
        yield full
      }
    }
  }
}

function scanFile(absPath: string): readonly Suppression[] {
  const content = readFileSync(absPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const result: Suppression[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (SUPPRESSION_PATTERN.test(line)) {
      result.push({
        file: relative(REPO_ROOT, absPath),
        line: i + 1,
        text: line.trim(),
        hasJustification: JUSTIFICATION_PATTERN.test(line),
      })
    }
  }
  return result
}

describe('eslint-disable — подавления должны иметь обоснование после `--` (Ж4)', () => {
  const allSuppressions: Suppression[] = []

  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(REPO_ROOT, dir))) {
      if (shouldSkip(file)) continue
      allSuppressions.push(...scanFile(file))
    }
  }

  it('обнаруживает хотя бы одно подавление (sanity)', () => {
    expect(allSuppressions.length).toBeGreaterThan(0)
  })

  it('каждое eslint-disable* имеет обоснование после `--`', () => {
    const offenders = allSuppressions.filter((s) => !s.hasJustification)
    if (offenders.length > 0) {
      // Выводим offenders, чтобы ревьюер видел, что чинить (см. STATE-AND-RESUME-POINT.md §11.4 задача 5.4).
      const summary = offenders
        .slice(0, 50)
        .map((o) => `  ${o.file}:${String(o.line)}  →  ${o.text}`)
        .join('\n')
      const more = offenders.length > 50 ? `\n  ... and ${String(offenders.length - 50)} more` : ''
      throw new Error(
        `Найдено ${String(offenders.length)} подавлений eslint-disable без обоснования после "--":\n${summary}${more}\n\n` +
          'Правило (AGENTS.md §4 / Ж4): каждое подавление должно иметь причину после "--". ' +
          'Если правило больше не срабатывает — удалите директиву; если срабатывает — добавьте обоснование.',
      )
    }
    expect(offenders.length).toBe(0)
  })
})