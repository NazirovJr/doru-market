import { describe, expect, it } from 'vitest'
import { useT } from '@dorutj/i18n'
import { formatDistanceLabel } from './offer-view'

const { t } = useT('ru')

describe('formatDistanceLabel', () => {
  it('null — нет подписи', () => {
    expect(formatDistanceLabel(null, 'ru', t)).toBeUndefined()
  })

  it('меньше километра — метры, округлённые до целого', () => {
    expect(formatDistanceLabel(412.6, 'ru', t)).toBe('413 м')
  })

  it('от километра — километры с одним знаком', () => {
    expect(formatDistanceLabel(1240, 'en', useT('en').t)).toBe('1.2 km')
  })
})
