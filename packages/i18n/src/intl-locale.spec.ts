import { describe, expect, it } from 'vitest'
import { toIntlLocale } from './intl-locale.js'
import type { Locale } from './use-t.js'

const ALL_LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

describe('toIntlLocale (граница между внутренним кодом локали и Intl)', () => {
  // Главный гейт файла. `Intl` не бросает на незарегистрированном теге — он молча
  // откатывается на en-US, поэтому единственный способ поймать негодный тег заранее —
  // спросить сам Intl, что он в итоге выбрал. Если кто-то впишет в маппинг несуществующий
  // код, этот тест покраснеет здесь, а не у пользователя в виде чужого форматирования.
  it.each(ALL_LOCALES)('%s → тег, который Intl принимает КАК ЕСТЬ, без тихого отката', (locale) => {
    const tag = toIntlLocale(locale)
    expect(Intl.getCanonicalLocales(tag)).toEqual([tag])
    expect(new Intl.NumberFormat(tag).resolvedOptions().locale).toBe(tag)
    expect(new Intl.DateTimeFormat(tag).resolvedOptions().locale).toBe(tag)
  })

  it('внутренний код tj НЕ пригоден для Intl напрямую — ради этого и нужен маппинг', () => {
    // Фиксируем сам дефект, чтобы правка «да передадим locale напрямую, и так работает»
    // не прошла ревью незамеченной: 'tj' не отвергается, он подменяется английским.
    expect(new Intl.NumberFormat('tj').resolvedOptions().locale).not.toBe('tj')
    expect(toIntlLocale('tj')).toBe('tg')
  })

  it('таджикский форматируется по-кириллически (запятая), а не по-американски (точка)', () => {
    const format = (locale: Locale): string =>
      new Intl.NumberFormat(toIntlLocale(locale), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(65)

    expect(format('tj')).toBe('65,00')
    expect(format('ru')).toBe('65,00')
    expect(format('en')).toBe('65.00')
  })
})
