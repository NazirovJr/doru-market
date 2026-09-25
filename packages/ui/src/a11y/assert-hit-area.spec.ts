/**
 * `assert-hit-area.spec.ts` (DTJ-403, критерии приёмки 1-2, тест-план тикета).
 *
 * `jsdom` не выполняет раскладку — `getBoundingClientRect()` всегда возвращает нули, поэтому
 * каждый тест задаёт размеры через inline-`style` и полагается на вычисление из
 * `getComputedStyle()` (см. `measureFromStyle` в `assert-hit-area.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  CRITICAL_HIT_AREA_PX,
  MIN_HIT_AREA_PX,
  assertHitArea,
  measureHitArea,
} from './assert-hit-area'

const makeButton = (styles: Partial<CSSStyleDeclaration>): HTMLButtonElement => {
  const button = document.createElement('button')
  Object.assign(button.style, styles)
  document.body.appendChild(button)
  return button
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('assertHitArea', () => {
  it('passes when effective hit area (including padding) meets minimum (AC1)', () => {
    // Визуал 40×40px + padding 4px с каждой стороны = эффективная область 48×48px.
    const button = makeButton({ width: '40px', height: '40px', padding: '4px', boxSizing: 'content-box' })
    expect(() => { assertHitArea(button, MIN_HIT_AREA_PX) }).not.toThrow()
  })

  it('fails with readable actual/required size when hit area is too small (AC2)', () => {
    const button = makeButton({ width: '32px', height: '32px', boxSizing: 'content-box' })
    expect(() => { assertHitArea(button, MIN_HIT_AREA_PX) }).toThrow(/32×32.*48×48/)
  })

  it('accounts for border-box sizing without double-counting padding', () => {
    // border-box: заявленные 48×48px уже ВКЛЮЧАЮТ padding — эффективная область ровно 48×48.
    const button = makeButton({ width: '48px', height: '48px', padding: '10px', boxSizing: 'border-box' })
    expect(() => { assertHitArea(button, MIN_HIT_AREA_PX) }).not.toThrow()
    expect(measureHitArea(button)).toEqual({ width: 48, height: 48 })
  })

  it('counts border width toward the effective hit area', () => {
    const button = makeButton({
      width: '44px',
      height: '44px',
      border: '2px solid black',
      boxSizing: 'content-box',
    })
    // 44 + 2 + 2 = 48
    expect(() => { assertHitArea(button, MIN_HIT_AREA_PX) }).not.toThrow()
  })

  it('enforces the larger critical hit area for pharmacy-cabinet critical actions', () => {
    const button = makeButton({ width: '48px', height: '48px', boxSizing: 'content-box' })
    expect(() => { assertHitArea(button, CRITICAL_HIT_AREA_PX) }).toThrow(/48×48.*56×56/)
  })

  it('does not compensate for a too-small box via negative margin hit-slop (unsupported in v1)', () => {
    // Отрицательный margin двигает соседей по раскладке, но НЕ увеличивает область, реально
    // принимающую касание (см. комментарий в assert-hit-area.ts) — сознательно игнорируется.
    const button = makeButton({
      width: '32px',
      height: '32px',
      margin: '-20px',
      boxSizing: 'content-box',
    })
    expect(() => { assertHitArea(button, MIN_HIT_AREA_PX) }).toThrow(/32×32.*48×48/)
  })

  it('rejects a non-positive minSizePx as a caller error', () => {
    const button = makeButton({ width: '48px', height: '48px' })
    expect(() => { assertHitArea(button, 0) }).toThrow(RangeError)
    expect(() => { assertHitArea(button, -1) }).toThrow(RangeError)
  })

  it('includes the accessible label in the error description when present', () => {
    const button = makeButton({ width: '20px', height: '20px' })
    button.setAttribute('aria-label', 'Удалить')
    expect(() => { assertHitArea(button, MIN_HIT_AREA_PX) }).toThrow(/«Удалить»/)
  })
})
