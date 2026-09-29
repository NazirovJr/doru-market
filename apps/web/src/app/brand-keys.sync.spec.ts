import { describe, expect, it } from 'vitest'
import { BrandPaletteSchema, BRAND_FONT_FAMILY_ALLOWLIST as CONTRACT_FONTS } from '@dorutj/contracts'
import { BRAND_COLOR_KEYS, BRAND_FONT_FAMILY_ALLOWLIST as UI_FONTS, LOCKED_SEMANTIC_KEYS } from '@dorutj/ui/tokens'

// packages/ui и packages/contracts не зависят друг от друга, поэтому список токенов сверяется здесь.
const cssName = (key: string): string => `--brand-${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`

describe('allowlist токенов бренда: contracts == ui', () => {
  it('редактируемые токены совпадают', () => {
    const uiTokens = [...BRAND_COLOR_KEYS, 'radius', 'fontFamily'].map(cssName)
    expect(Object.keys(BrandPaletteSchema.shape).sort()).toEqual(uiTokens.sort())
  })

  it('семантические токены, залоченные в ui, схема контрактов не принимает', () => {
    for (const key of LOCKED_SEMANTIC_KEYS) {
      expect(Object.keys(BrandPaletteSchema.shape)).not.toContain(cssName(key))
    }
  })

  it('шрифтовые стеки совпадают', () => {
    expect([...CONTRACT_FONTS]).toEqual([...UI_FONTS])
  })
})
