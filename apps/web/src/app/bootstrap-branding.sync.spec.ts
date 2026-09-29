import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NEUTRAL_FALLBACK_PALETTE } from '@dorutj/contracts'

// Разбирает первый :root-блок <style> в index.html: `--token: value;` -> { '--token': 'value' }.
function readRootTokens(html: string): Record<string, string> {
  const block = /:root\s*\{([^}]*)\}/u.exec(html)?.[1] ?? ''
  return Object.fromEntries([...block.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/gu)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]))
}

describe(':root в index.html синхронизирован с NEUTRAL_FALLBACK_PALETTE', () => {
  const html = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8')

  it('значения совпадают токен в токен', () => {
    expect(readRootTokens(html)).toEqual(NEUTRAL_FALLBACK_PALETTE)
  })

  it('рассинхронизированное значение ловится', () => {
    const drifted = html.replace('--brand-primary: #64748b', '--brand-primary: #ff0000')
    expect(readRootTokens(drifted)).not.toEqual(NEUTRAL_FALLBACK_PALETTE)
  })
})
