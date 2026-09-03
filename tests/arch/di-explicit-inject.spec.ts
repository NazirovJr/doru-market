/**
 * Arch-тест на конвенцию DTJ-001: КАЖДЫЙ параметр конструктора Nest-класса обязан нести
 * явный `@Inject(ТОКЕН)`.
 *
 * Почему это отдельный гейт, а не «стиль». `apps/api` собирается esbuild'ом (vitest) и
 * запускается нативным Node ESM — ни там, ни там НЕ эмитится `design:paramtypes`. Nest
 * строит список зависимостей только из явных `@Inject`, и недекорированный параметр
 * ведёт себя одним из двух способов, оба тихие для `tsc`, `eslint` и обычных юнит-тестов:
 *
 *   ЖЁСТКИЙ — параметр стоит ПЕРЕД каким-либо декорированным: он попадает в paramtypes
 *   как `undefined`, Nest пытается резолвить токен `undefined` и роняет весь `AppModule`
 *   («can't resolve dependencies of the X (?, ...)»). Так не поднимался бут из-за
 *   `IdempotencyInterceptor` (глобальный APP_INTERCEPTOR) и `PharmacyChainsPublicController`.
 *
 *   ТИХИЙ — параметр стоит ПОСЛЕ всех декорированных: он просто не попадает в paramtypes,
 *   класс создаётся с меньшим числом аргументов, поле остаётся `undefined`, бут проходит
 *   зелёным, а `TypeError` прилетает на первом реальном вызове. Так был сломан глобальный
 *   `TenantScopeGuard`: `this.reflector` === undefined на КАЖДОМ защищённом эндпоинте.
 *
 * Тихий вариант опаснее: он не ловится ничем, кроме живого вызова, и юнит-тест с ручным
 * `new Guard(reflector)` остаётся зелёным, потому что обходит DI вообще.
 *
 * Исключение ровно одно и оно вычисляется, а не перечисляется руками: класс, который
 * где-то создаётся вручную через `new <Класс>(` вне собственного файла, DI не резолвит
 * (`ZodValidationPipe`, `CursorQueryPipe` — они передаются в `@Body(new ...)`/`@Query(...)`).
 * Параметр со значением по умолчанию тоже допустим: Nest создаст класс без аргументов,
 * и умолчание применится штатно.
 *
 * Парсинг текстовый, без AST-зависимостей — так же, как в `runtime-connectivity.spec.ts`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(__dirname, '../..')
const SRC_DIR = path.join(REPO_ROOT, 'apps/api/src')

interface Violation {
  readonly file: string
  readonly className: string
  readonly paramIndex: number
  readonly param: string
  readonly kind: 'ЖЁСТКИЙ' | 'ТИХИЙ'
}

function listTsFiles(dir: string): readonly string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full)
    }
  }
  return out
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '')
}

/** Содержимое круглых скобок конструктора с учётом вложенности. */
function extractConstructorParams(afterClass: string): string | null {
  const match = /\bconstructor\s*\(/u.exec(afterClass)
  if (match === null) {
    return null
  }
  const nextClass = /[\r\n](?:export\s+)?class\s+\w+/u.exec(afterClass)
  if (nextClass !== null && match.index > nextClass.index) {
    return null
  }
  let depth = 1
  let i = match.index + match[0].length
  const start = i
  while (i < afterClass.length && depth > 0) {
    const ch = afterClass[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    i += 1
  }
  return afterClass.slice(start, i - 1)
}

const BRACKET_OPENERS = new Set(['(', '[', '{', '<'])
const BRACKET_CLOSERS = new Set([')', ']', '}', '>'])

/** +1 на открывающей скобке, -1 на закрывающей, 0 на всём остальном. */
function depthDelta(char: string): number {
  if (BRACKET_OPENERS.has(char)) return 1
  if (BRACKET_CLOSERS.has(char)) return -1
  return 0
}

/** Разбиение по запятым верхнего уровня: дженерики `<A, B>` и объектные типы не режутся. */
function splitTopLevel(params: string): readonly string[] {
  const segments: string[] = []
  let depth = 0
  let current = ''
  for (const char of params) {
    depth += depthDelta(char)
    if (char === ',' && depth === 0) {
      segments.push(current)
      current = ''
    } else {
      current += char
    }
  }
  segments.push(current)
  return segments.filter((segment) => segment.trim().length > 0)
}

/**
 * Параметр со значением по умолчанию БЕЗ `@Optional()` — тоже дефект, и он коварнее прочих:
 * под vitest (esbuild) метаданных нет, класс создаётся без аргументов, умолчание применяется,
 * и тест подъёма `AppModule` зелёный. А боевая сборка идёт через `tsc` с
 * `emitDecoratorMetadata: true`, который эмитит `design:paramtypes: [Array]` — Nest ищет
 * провайдера для `Array`, не находит и НЕ СТАРТУЕТ. Поймано запуском собранного `dist/main.js`
 * (`InMemoryMedicineReadRepository`, `InMemoryCategoriesReadRepository`).
 * Поэтому здесь освобождается только параметр, который несёт `@Optional()`: с ним Nest
 * подставляет `undefined`, и умолчание срабатывает в ОБЕИХ сборках одинаково.
 */
function isExempt(param: string): boolean {
  return param.includes('@Optional') && hasDefaultValue(param)
}

/** Есть ли у параметра значение по умолчанию (`= ...` на верхнем уровне). */
function hasDefaultValue(param: string): boolean {
  let depth = 0
  for (const char of param) {
    depth += depthDelta(char)
    if (char === '=' && depth === 0) return true
  }
  return false
}

const FILES = listTsFiles(SRC_DIR)
const ALL_SOURCE = FILES.map((f) => ({ file: f, text: fs.readFileSync(f, 'utf-8') }))

/** Класс создаётся вручную где-то ВНЕ своего файла — значит DI его не резолвит. */
function isManuallyConstructed(className: string, ownFile: string): boolean {
  const needle = `new ${className}(`
  return ALL_SOURCE.some(({ file, text }) => file !== ownFile && text.includes(needle))
}

/**
 * Класс, который продакшен-код нигде не упоминает, Nest не может ни зарегистрировать,
 * ни создать — требовать от него `@Inject` бессмысленно. Так отсекается `CursorQueryPipe`:
 * он используется только в собственной спеке. Это, кстати, сигнал о мёртвом коде, но
 * предмет отдельного тикета, а не этого гейта.
 */
function isUnreferencedInProduction(className: string, ownFile: string): boolean {
  return !ALL_SOURCE.some(({ file, text }) => file !== ownFile && text.includes(className))
}

function collectViolations(): readonly Violation[] {
  const violations: Violation[] = []
  for (const { file, text } of ALL_SOURCE) {
    // Между `@Controller(...)`/`@Injectable()` и `class` может стоять СКОЛЬКО УГОДНО
    // других декораторов (`@Public()`, `@UseGuards(...)`, `@Roles(...)`). Первая редакция
    // требовала `class` непосредственно следующей строкой и потому НЕ ВИДЕЛА 17 из 21
    // контроллера — гейт был зелёным не потому, что нарушений нет, а потому, что он их
    // не смотрел. Так и пропустил `MedicinesController` с двумя параметрами без
    // `@Inject`. Правка CTO по итогам приёмки волны 5 (`CLAUDE-CTO.md` §1 — гейты
    // чинит CTO, это инструмент контроля, а не предмет контроля).
    const classRe =
      /@(?:Injectable|Controller)\s*\([^)]*\)(?:\s*@\w+(?:\s*\([^)]*\))?)*\s*(?:export\s+)?class\s+(\w+)/gu
    let m: RegExpExecArray | null
    while ((m = classRe.exec(text)) !== null) {
      const className = m[1]
      const rawParams = extractConstructorParams(text.slice(m.index + m[0].length))
      if (rawParams === null || rawParams.trim().length === 0) continue
      if (isManuallyConstructed(className, file)) continue
      if (isUnreferencedInProduction(className, file)) continue
      const segments = splitTopLevel(stripComments(rawParams))
      const decorated = segments
        .map((s, i) => (s.includes('@Inject') ? i : -1))
        .filter((i) => i >= 0)
      const lastDecorated = decorated.length > 0 ? Math.max(...decorated) : -1
      segments.forEach((segment, index) => {
        if (segment.includes('@Inject') || isExempt(segment)) return
        violations.push({
          file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
          className,
          paramIndex: index,
          param: segment.trim().replace(/\s+/gu, ' ').slice(0, 80),
          kind: index < lastDecorated ? 'ЖЁСТКИЙ' : 'ТИХИЙ',
        })
      })
    }
  }
  return violations
}

describe('DI: явный @Inject на каждом параметре конструктора (DTJ-001)', () => {
  it('ни один Nest-класс не полагается на design:paramtypes', () => {
    const violations = collectViolations()
    const report = violations
      .map((v) => `[${v.kind}] ${v.file} → ${v.className} param[${String(v.paramIndex)}]: ${v.param}`)
      .join('\n')
    expect(report, `Параметры без @Inject (esbuild не эмитит design:paramtypes):\n${report}`).toBe('')
  })
})
