import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from './dictionaries/en.json' with { type: 'json' }
import ru from './dictionaries/ru.json' with { type: 'json' }
import tj from './dictionaries/tj.json' with { type: 'json' }
import { useT } from './use-t.js'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

describe('useT', () => {
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
  })

  it('returns the canonical tj text 1:1 for ux.error.otp_locked (30-ux-screens-and-flows.md §5)', () => {
    const { t } = useT('tj')

    expect(t('ux.error.otp_locked')).toBe(
      'Кӯшишҳои зиёди нодуруст. Рамзи навро тавассути SMS/Telegram дархост кунед.',
    )
  })

  it('interpolates a {param} placeholder with the given value', () => {
    const { t } = useT('ru')

    expect(t('auth.login.code_sent_to', { phone: '+992 90 123 45 67' })).toBe(
      'Код отправлен на +992 90 123 45 67',
    )
  })

  it('interpolates a numeric param by converting it to a string', () => {
    const { t } = useT('en')

    expect(t('ux.error.otp_mismatch', { attemptsLeft: 2 })).toBe('Wrong code. Attempts left: 2')
  })

  it('leaves an unmatched placeholder untouched when no param is supplied for it', () => {
    const { t } = useT('en')

    expect(t('auth.login.code_sent_to')).toBe('Code sent to {phone}')
  })

  it('returns the plain dictionary string when the key has no placeholders', () => {
    const { t } = useT('ru')

    expect(t('ux.error.otp_expired')).toBe('Код устарел. Запросите новый.')
  })

  describe('missing key', () => {
    it('returns a visible [[missing: ...]] marker in development, not an empty string', () => {
      process.env.NODE_ENV = 'development'
      const { t } = useT('ru')

      expect(t('ux.does.not.exist')).toBe('[[missing: ux.does.not.exist]]')
    })

    it('falls back to the en dictionary with a console.warn in production', async () => {
      // Реальные словари всегда параллельны по ключам (см. describe ниже) — эта ветка
      // (ключ есть в en, но не в текущей локали) защитная, тестируем её через подмену
      // tj-словаря на заведомо неполный, не нарушая инвариант паритета реальных файлов.
      process.env.NODE_ENV = 'production'
      vi.resetModules()
      vi.doMock('./dictionaries/tj.json', () => ({ default: { 'brand.name': 'DoruTJ' } }))

      const { useT: useTWithIncompleteTj } = await import('./use-t')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { t } = useTWithIncompleteTj('tj')

      expect(t('ux.error.otp_expired')).toBe(en['ux.error.otp_expired'])
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0]?.[0]).toContain('ux.error.otp_expired')

      warnSpy.mockRestore()
      vi.doUnmock('./dictionaries/tj.json')
      vi.resetModules()
    })

    it('falls back to the visible marker in production when the key is missing in en too', () => {
      process.env.NODE_ENV = 'production'
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { t } = useT('ru')

      expect(t('ux.does.not.exist')).toBe('[[missing: ux.does.not.exist]]')

      vi.restoreAllMocks()
    })
  })
})

describe('dictionary key parity (tj/ru/en)', () => {
  let tjKeys: string[]
  let ruKeys: string[]
  let enKeys: string[]

  beforeEach(() => {
    tjKeys = Object.keys(tj).sort()
    ruKeys = Object.keys(ru).sort()
    enKeys = Object.keys(en).sort()
  })

  it('has a non-empty key set', () => {
    expect(tjKeys.length).toBeGreaterThan(0)
  })

  it('tj and ru dictionaries expose an identical set of keys', () => {
    expect(tjKeys).toEqual(ruKeys)
  })

  it('tj and en dictionaries expose an identical set of keys', () => {
    expect(tjKeys).toEqual(enKeys)
  })
})
