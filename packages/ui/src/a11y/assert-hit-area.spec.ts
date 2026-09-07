import { afterEach, describe, expect, it } from 'vitest'
import { assertHitArea, measureHitArea } from './assert-hit-area'

const HIT_AREA_MIN_PX = 48
const VISUAL_SIZE_PX = 40
const PADDING_PX = 4
const EFFECTIVE_SIZE_PX = 48
const SMALL_SIZE_PX = 32
const NEGATIVE_MARGIN_PX = -20

function createRect(widthPx: number, heightPx: number): DOMRect {
  return {
    width: widthPx,
    height: heightPx,
    top: 0,
    left: 0,
    right: widthPx,
    bottom: heightPx,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
}

function createButton(sizePx: number, paddingPx: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.style.padding = `${String(paddingPx)}px`
  button.getBoundingClientRect = () => createRect(sizePx, sizePx)
  document.body.appendChild(button)
  return button
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('assertHitArea', () => {
  it('passes when effective hit area (including padding) meets minimum', () => {
    const button = createButton(VISUAL_SIZE_PX, PADDING_PX)

    expect(measureHitArea(button)).toEqual({ widthPx: EFFECTIVE_SIZE_PX, heightPx: EFFECTIVE_SIZE_PX })
    expect(() => {
      assertHitArea(button, HIT_AREA_MIN_PX)
    }).not.toThrow()
  })

  it('fails with readable actual/required size when hit area is too small', () => {
    const button = createButton(SMALL_SIZE_PX, 0)
    const smallLabel = `${String(SMALL_SIZE_PX)}×${String(SMALL_SIZE_PX)}`
    const minLabel = `${String(HIT_AREA_MIN_PX)}×${String(HIT_AREA_MIN_PX)}`

    expect(() => {
      assertHitArea(button, HIT_AREA_MIN_PX)
    }).toThrow(`Hit-area too small: actual ${smallLabel}, required ${minLabel} minimum (SRS-UX-002).`)
  })

  it('ignores non-px padding values (documented jsdom-resolution limitation)', () => {
    const button = createButton(SMALL_SIZE_PX, 0)
    button.style.paddingLeft = '10%'

    // jsdom не резолвит проценты в getComputedStyle до px — значение остаётся "10%",
    // не проходит проверку на суффикс "px", поэтому не учитывается (см. JSDoc assert-hit-area.ts).
    expect(measureHitArea(button)).toEqual({ widthPx: SMALL_SIZE_PX, heightPx: SMALL_SIZE_PX })
  })

  it('does not treat negative margin as hit-slop (documented v1 limitation)', () => {
    const button = createButton(SMALL_SIZE_PX, 0)
    button.style.margin = `${String(NEGATIVE_MARGIN_PX)}px`

    // margin (в т.ч. отрицательный) не увеличивает кликабельную область — см. JSDoc
    // assert-hit-area.ts. Проверка обязана остаться падающей независимо от margin.
    expect(measureHitArea(button)).toEqual({ widthPx: SMALL_SIZE_PX, heightPx: SMALL_SIZE_PX })
    expect(() => {
      assertHitArea(button, HIT_AREA_MIN_PX)
    }).toThrow()
  })
})
