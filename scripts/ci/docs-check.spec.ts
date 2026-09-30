/**
 * Тесты `scripts/ci/docs-check.mjs` на синтетическом дереве во временном каталоге.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkAgentsLength,
  checkDocsIndex,
  checkMarkdownLinks,
  checkPathLiterals,
  extractMarkdownLinks,
  MAX_AGENTS_LINES,
  resolveLinkTarget,
} from './docs-check.mjs'

const roots: string[] = []

function makeTree(files: Record<string, string>): { root: string; list: string[] } {
  const root = mkdtempSync(path.join(tmpdir(), 'docs-check-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  return { root, list: Object.keys(files) }
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('extractMarkdownLinks', () => {
  it('находит inline- и reference-ссылки, пропускает код', () => {
    const md = ['[a](one.md) [b](two.md#x "t")', '`[c](inline-code.md)`', '```', '[d](fenced.md)', '```', '[ref]: three.md'].join('\n')
    expect(extractMarkdownLinks(md).map((l) => l.target)).toEqual(['one.md', 'two.md#x', 'three.md'])
  })
})

describe('resolveLinkTarget', () => {
  it('игнорирует http, mailto, якоря и абсолютные пути', () => {
    for (const t of ['https://x.io/a.md', 'mailto:a@b.c', '#top', '/abs.md']) expect(resolveLinkTarget('/r', 'a.md', t)).toBeNull()
  })

  it('резолвит относительно каталога файла и отбрасывает якорь', () => {
    expect(resolveLinkTarget('/r', 'docs/a/x.md', '../b/y.md#sec')).toBe('docs/b/y.md')
  })
})

describe('checkMarkdownLinks', () => {
  it('живая ссылка проходит', () => {
    const { root, list } = makeTree({ 'docs/a.md': '[b](b.md#s)', 'docs/b.md': '#' })
    expect(checkMarkdownLinks(root, list)).toEqual({ errors: [], warnings: [] })
  })

  it('битая ссылка — ошибка (негативный кейс)', () => {
    const { root, list } = makeTree({ 'docs/a.md': '[b](missing.md)' })
    const { errors, warnings } = checkMarkdownLinks(root, list)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('docs/a.md:1')
    expect(warnings).toEqual([])
  })

  it('битая ссылка в docs/history и tickets — предупреждение, не ошибка', () => {
    const { root, list } = makeTree({ 'docs/history/h.md': '[x](gone.md)', 'tickets/t.md': '[x](gone.md)' })
    const { errors, warnings } = checkMarkdownLinks(root, list)
    expect(errors).toEqual([])
    expect(warnings).toHaveLength(2)
  })
})

describe('checkPathLiterals', () => {
  it('существующий путь проходит, http-ссылки и сокращения с "..." игнорируются', () => {
    const { root, list } = makeTree({
      'apps/a.ts': '// см. docs/x.md, apps/api/.../y.ts, https://h.io/docs/nope.md',
      'docs/x.md': '#',
    })
    expect(checkPathLiterals(root, list).errors).toEqual([])
  })

  it('несуществующий путь в коде — ошибка (негативный кейс)', () => {
    const { root, list } = makeTree({ 'apps/a.ts': "// docs/gone.md\nconst p = 'scripts/none.ts'" })
    const { errors } = checkPathLiterals(root, list)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('apps/a.ts:1')
  })

  it('docs/api/openapi.json в allowlist (генерируемый артефакт)', () => {
    const { root, list } = makeTree({ 'ci.yml': '# docs/api/openapi.json' })
    expect(checkPathLiterals(root, list).errors).toEqual([])
  })

  it('markdown-файлы этой проверкой не сканируются', () => {
    const { root, list } = makeTree({ 'docs/a.md': '`docs/gone.md`' })
    expect(checkPathLiterals(root, list).errors).toEqual([])
  })
})

describe('checkAgentsLength', () => {
  it('длиннее лимита — ошибка (негативный кейс), в пределах — тишина', () => {
    const long = makeTree({ 'AGENTS.md': 'x\n'.repeat(MAX_AGENTS_LINES + 5) })
    const { errors, warnings } = checkAgentsLength(long.root, long.list)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('AGENTS.md')
    expect(warnings).toEqual([])
    const short = makeTree({ 'AGENTS.md': 'x\n'.repeat(10) })
    expect(checkAgentsLength(short.root, short.list)).toEqual({ errors: [], warnings: [] })
  })
})

describe('checkDocsIndex', () => {
  it('файл, на который есть ссылка из docs/README.md, проходит; docs/history и не-документы исключены', () => {
    const { root, list } = makeTree({
      'docs/README.md': '[a](a/x.md)',
      'docs/a/x.md': '#',
      'docs/history/old.md': '#',
      'docs/design/canvas.html': '<p>',
    })
    expect(checkDocsIndex(root, list)).toEqual({ errors: [], warnings: [] })
  })

  it('файл без ссылки из индекса — ошибка (негативный кейс)', () => {
    const { root, list } = makeTree({ 'docs/README.md': '[a](a.md)', 'docs/a.md': '#', 'docs/orphan.md': '#' })
    expect(checkDocsIndex(root, list).errors).toEqual(['docs/orphan.md: нет ссылки из docs/README.md'])
  })

  it('README.md папки, на который ссылается индекс, покрывает файлы папки', () => {
    const { root, list } = makeTree({
      'docs/README.md': '[d](adr/README.md)',
      'docs/adr/README.md': '#',
      'docs/adr/d-01.md': '#',
      'docs/other/d-02.md': '#',
    })
    expect(checkDocsIndex(root, list).errors).toEqual(['docs/other/d-02.md: нет ссылки из docs/README.md'])
  })

  it('нет docs/README.md — ошибка', () => {
    const { root, list } = makeTree({ 'docs/a.md': '#' })
    expect(checkDocsIndex(root, list).errors).toHaveLength(1)
  })
})
