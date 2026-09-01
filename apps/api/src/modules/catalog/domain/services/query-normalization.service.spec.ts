import { describe, expect, it } from 'vitest'
import { QueryNormalizationService } from './query-normalization.service.js'
import { TransliterationNormalizerService } from './transliteration-normalizer.service.js'

// Фикстура-подмножество packages/i18n/translit-map.json — достаточно записи
// "qalb" → "калб" для сценария AC2/TC-CAT-007. Полная таблица не нужна: этот
// файл тестирует пайплайн нормализации, не саму транслитерацию (за неё отвечает
// transliteration-normalizer.service.spec.ts).
function makeService(): QueryNormalizationService {
  const transliterator = new TransliterationNormalizerService({ qalb: 'калб' })
  return new QueryNormalizationService(transliterator)
}

describe('QueryNormalizationService.normalize (SRS-CAT-024, критерии приёмки DTJ-182)', () => {
  describe('AC1 + детекция штрихкода (8/12/13/14 цифр — позитив)', () => {
    const service = makeService()

    it('AC1: 13-значный штрихкод → mode="barcode", value сохранён, alternate отсутствует как поле', () => {
      const result = service.normalize('4870123456789')
      expect(result.mode).toBe('barcode')
      if (result.mode !== 'barcode') throw new Error('unreachable')
      expect(result.value).toBe('4870123456789')
      expect('alternate' in result).toBe(false)
      expect('primary' in result).toBe(false)
    })

    it.each([
      ['8 цифр', '12345678'],
      ['12 цифр', '123456789012'],
      ['13 цифр', '1234567890123'],
      ['14 цифр', '12345678901234'],
    ])('%s распознаются как штрихкод', (_label, digits) => {
      const result = service.normalize(digits)
      expect(result.mode).toBe('barcode')
    })
  })

  describe('детекция штрихкода — негативные сценарии (регресс-защита от переразмывания regex)', () => {
    const service = makeService()

    it.each([
      ['7 цифр — короче минимума', '1234567'],
      ['15 цифр — длиннее максимума', '123456789012345'],
      ['9 цифр — в разрыве между 8 и 12', '123456789'],
      ['13 цифр с буквой — не штрихкод', '123456789012A'],
    ])('%s НЕ распознаются как штрихкод, уходят в текстовую ветку', (_label, text) => {
      const result = service.normalize(text)
      expect(result.mode).toBe('text')
    })
  })

  it('AC2/TC-CAT-007: "qalb" → primary="qalb", alternate="калб" через транслитерацию', () => {
    const service = makeService()
    const result = service.normalize('qalb')
    expect(result.mode).toBe('text')
    if (result.mode !== 'text') throw new Error('unreachable')
    expect(result.primary).toBe('qalb')
    expect(result.alternate).toBe('калб')
  })

  it('AC3/SRS-CAT-078: "цытрамон" (кириллическая опечатка) — эвристика транслита НЕ срабатывает', () => {
    const service = makeService()
    const result = service.normalize('цытрамон')
    expect(result.mode).toBe('text')
    if (result.mode !== 'text') throw new Error('unreachable')
    expect(result.alternate).toBeNull()
  })

  it('AC4: лишние пробелы по краям и внутри схлопываются, primary === "Цитрамон"', () => {
    const service = makeService()
    const result = service.normalize('   Цитрамон    ')
    expect(result.mode).toBe('text')
    if (result.mode !== 'text') throw new Error('unreachable')
    expect(result.primary).toBe('Цитрамон')
  })

  it('схлопывание внутренних повторных пробелов (не только по краям)', () => {
    const service = makeService()
    const result = service.normalize('пара   цетамол')
    expect(result.mode).toBe('text')
    if (result.mode !== 'text') throw new Error('unreachable')
    expect(result.primary).toBe('пара цетамол')
  })

  it('TC-CAT-006: корректно набранная таджикская кириллица (ӯ, ғ) не трогается', () => {
    // Синтетическая строка, не настоящее слово — важны только буквы ӯ/ғ как
    // представители таджикского набора: сервис не обязан их менять, эвристика
    // транслита не должна ложно сработать на уже правильном тексте.
    const service = makeService()
    const result = service.normalize('абӯғ')
    expect(result.mode).toBe('text')
    if (result.mode !== 'text') throw new Error('unreachable')
    expect(result.primary).toBe('абӯғ')
    expect(result.alternate).toBeNull()
  })

  describe('эвристика «похоже на транслит» — обе ветки условия проверены раздельно', () => {
    const service = makeService()

    it('ветка А (доля латиницы > 60%) срабатывает даже при наличии кириллицы в строке', () => {
      // 4 латинские (w,x,y,z) + 1 таджикская кириллица (д) = 5 букв, доля 0.8 > 0.6.
      // hasTajikCyrillic истинно (есть "д") — то есть срабатывает ИМЕННО ветка А,
      // а не Б, что и требуется проверить отдельно от ветки Б.
      const result = service.normalize('wxyzд')
      expect(result.mode).toBe('text')
      if (result.mode !== 'text') throw new Error('unreachable')
      expect(result.alternate).not.toBeNull()
    })

    it('граница: доля латиницы РОВНО 60% — НЕ строго больше, ветка А не срабатывает', () => {
      // 3 латинские (x,y,z) + 2 таджикские кириллические (ж,д) = 5 букв, доля 0.6.
      const result = service.normalize('xyzжд')
      expect(result.mode).toBe('text')
      if (result.mode !== 'text') throw new Error('unreachable')
      expect(result.alternate).toBeNull()
    })

    it('ветка Б (нет ни одной буквы таджикского набора) срабатывает независимо от доли латиницы', () => {
      // Буквы с диакритикой (é) — не ASCII-латиница по LATIN_LETTER_PATTERN и не
      // входят в набор а-яёӣӯҳқғҷ, поэтому доля латиницы здесь 0% (ветка А ложна),
      // но условие «есть буквы, и ни одна не из таджикского набора» истинно —
      // ветка Б обязана сработать сама по себе, без помощи ветки А.
      const result = service.normalize('ééé')
      expect(result.mode).toBe('text')
      if (result.mode !== 'text') throw new Error('unreachable')
      expect(result.alternate).not.toBeNull()
    })

    it('строка без единой буквы (например, отфильтрованная символика) — эвристика не срабатывает', () => {
      const result = service.normalize('...---...')
      expect(result.mode).toBe('text')
      if (result.mode !== 'text') throw new Error('unreachable')
      expect(result.alternate).toBeNull()
    })
  })
})
