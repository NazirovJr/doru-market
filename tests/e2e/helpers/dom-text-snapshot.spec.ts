// page.evaluate мокается — реальный DOM-обход проверяет живой прогон specs/cuj-12-i18n.pw.spec.ts.
import { describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { captureVisibleTextSnapshot } from './dom-text-snapshot.js'

function makePage(rawValues: string[]): Page {
  return { evaluate: vi.fn(() => Promise.resolve(rawValues)) } as unknown as Page
}

describe('captureVisibleTextSnapshot', () => {
  it('отбрасывает пустые и чисто числовые токены (динамические ID/суммы) по умолчанию', async () => {
    const page = makePage(['Каталог', '', '  ', '12345', '1 250', '2026-09-27', 'DoruTJ'])

    const snapshot = await captureVisibleTextSnapshot(page)

    expect(snapshot).toEqual(new Set(['Каталог', 'DoruTJ']))
  })

  it('позволяет переопределить ignorePattern для сценарий-специфичной нормализации', async () => {
    const page = makePage(['Заказ #ABC-1', 'Каталог'])

    const snapshot = await captureVisibleTextSnapshot(page, { ignorePattern: /^Заказ #.+$/ })

    expect(snapshot).toEqual(new Set(['Каталог']))
  })
})
