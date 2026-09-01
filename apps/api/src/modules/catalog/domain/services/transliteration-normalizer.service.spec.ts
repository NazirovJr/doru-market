import { describe, expect, it } from 'vitest'
import { TransliterationNormalizerService } from './transliteration-normalizer.service.js'

describe('TransliterationNormalizerService.transliterate (SRS-CAT-024 п.3, тест-план DTJ-182)', () => {
  it('пустая строка на входе → пустая строка на выходе', () => {
    const service = new TransliterationNormalizerService({ a: 'а' })
    expect(service.transliterate('')).toBe('')
  })

  it('пустая таблица → строка проходит без изменений (в нижнем регистре)', () => {
    const service = new TransliterationNormalizerService({})
    expect(service.transliterate('Qalb')).toBe('qalb')
  })

  it('символы вне таблицы не трогаются (копируются как есть)', () => {
    const service = new TransliterationNormalizerService({ a: 'а', b: 'б' })
    // '9' и '!' не входят в таблицу — остаются как есть, 'a'/'b' заменяются.
    expect(service.transliterate('a9!b')).toBe('а9!б')
  })

  describe('жадный longest-match по подстрокам (общий механизм, без привязки к лингвистике)', () => {
    const table = { ab: 'X', a: 'Y', b: 'Z' }

    it('двухбуквенный ключ побеждает два однобуквенных на той же позиции', () => {
      const service = new TransliterationNormalizerService(table)
      expect(service.transliterate('ab')).toBe('X')
    })

    it('при отсутствии двухбуквенного ключа применяются однобуквенные по очереди', () => {
      const service = new TransliterationNormalizerService(table)
      expect(service.transliterate('ba')).toBe('ZY')
    })

    it('несовпавший хвост копируется как есть после совпавшего префикса', () => {
      const service = new TransliterationNormalizerService(table)
      expect(service.transliterate('abc')).toBe('Xc')
    })
  })

  describe('кураторские спецслучаи из тикета (DTJ-182 «Что сделать» п.3)', () => {
    // Локальная фикстура-подмножество реальной packages/i18n/translit-map.json —
    // тест домена не читает файл из другого пакета (домен без I/O, `02` §2.6),
    // но подмножество совпадает по значениям, чтобы регресс был реалистичным.
    const table = {
      qalb: 'калб',
      gh: 'ғ',
      kh: 'х',
      ii: 'ӣ',
      uu: 'ӯ',
      j: 'ҷ',
      q: 'қ',
      h: 'ҳ',
      a: 'а',
      l: 'л',
      b: 'б',
    }
    const service = new TransliterationNormalizerService(table)

    it('регрессия: "qalb" целиком даёт "калб" (обычное "к", НЕ "қ")', () => {
      // Если бы применялось только посимвольное правило q→қ, результат был бы
      // "қалб" — неверно. Слово-исключение "qalb" обязано победить как более
      // длинное совпадение на позиции 0.
      expect(service.transliterate('qalb')).toBe('калб')
    })

    it('диграф "gh" применяется как единое целое → "ғ", не "г"+"h"', () => {
      expect(service.transliterate('gh')).toBe('ғ')
    })

    it('диграф "kh" применяется как единое целое → "х"', () => {
      expect(service.transliterate('kh')).toBe('х')
    })

    it('диграф "ii" применяется как единое целое → "ӣ"', () => {
      expect(service.transliterate('ii')).toBe('ӣ')
    })

    it('диграф "uu" применяется как единое целое → "ӯ"', () => {
      expect(service.transliterate('uu')).toBe('ӯ')
    })

    it('одиночные "q"/"h"/"j" вне диграфов и вне "qalb" — по однобуквенному правилу', () => {
      expect(service.transliterate('q')).toBe('қ')
      expect(service.transliterate('h')).toBe('ҳ')
      expect(service.transliterate('j')).toBe('ҷ')
    })
  })

  it('регистр входа игнорируется — результат всегда в нижнем регистре таблицы', () => {
    const service = new TransliterationNormalizerService({ qalb: 'калб' })
    expect(service.transliterate('QALB')).toBe('калб')
    expect(service.transliterate('Qalb')).toBe('калб')
  })
})
