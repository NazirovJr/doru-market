/**
 * Unit-тест `ResolveMedicineByCompositeUseCase` (DTJ-097, EP-04).
 *
 * Покрывает ВСЕ 4 критерия приёмки тикета + дополнительные сценарии из
 * тест-плана: внутренний префикс → fuzzy; `rawBarcode=null` → fuzzy;
 * неоднозначность → `ambiguous` без авто-выбора; дозировка отбрасывает
 * единственного кандидата.
 *
 * Использует in-memory мок `FuzzyMedicineMatcher` (НЕ `DrizzleDb`), потому
 * что use case зависит от порта, а не от инфраструктуры — мок порта
 * достаточно.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { isOk, isErr } from '@dorutj/domain-kernel'
import {
  ResolveMedicineByCompositeUseCase,
  InvalidCompositeMatchInputError,
} from './resolve-medicine-by-composite.use-case.js'
import type { ResolveMedicineByCompositeResult } from './resolve-medicine-by-composite.use-case.js'
import type {
  FuzzyCandidate,
  FuzzyMedicineMatcher,
} from '../ports/fuzzy-medicine-matcher.port.js'
import type { CompositeMatchInput, MedicineMatchResult } from '../../index.js'

/**
 * Хелпер для тестов: выполняет use case и возвращает `value` (бросает если
 * `err`). Сокращает шум и автоматически даёт TypeScript narrowing через
 * `isOk(result)` (см. `packages/domain-kernel/src/common/result.ts`).
 */
function unwrap(result: ResolveMedicineByCompositeResult): MedicineMatchResult {
  if (!isOk(result)) {
    throw new Error(`expected ok, got err: ${String(result.error)}`)
  }
  return result.value
}

/**
 * In-memory мок `FuzzyMedicineMatcher`. Два независимых spy: штрихкод и
 * fuzzy. Если штрихкод дал результат — мы проверяем, что fuzzy НЕ
 * вызывался (критерий приёмки #1).
 */
function makeFuzzyMatcherMock(opts: {
  readonly barcodeId: string | null
  readonly fuzzyCandidates: readonly FuzzyCandidate[]
}): FuzzyMedicineMatcher & {
  readonly findByBarcodeSpy: ReturnType<typeof vi.fn>
  readonly findCandidatesByFuzzySpy: ReturnType<typeof vi.fn>
} {
  const findByBarcodeSpy = vi.fn((_raw: string | null): Promise<string | null> => Promise.resolve(opts.barcodeId))
  const findCandidatesByFuzzySpy = vi.fn(
    (_input: Parameters<FuzzyMedicineMatcher['findCandidatesByFuzzy']>[0]): Promise<readonly FuzzyCandidate[]> =>
      Promise.resolve(opts.fuzzyCandidates),
  )
  return {
    findByBarcode: findByBarcodeSpy,
    findCandidatesByFuzzy: findCandidatesByFuzzySpy,
    findByBarcodeSpy,
    findCandidatesByFuzzySpy,
  }
}

/** Минимальный `ConfigService` без ENV — все ключи дают `undefined`. */
function makeConfigService(): ConfigService {
  return {
    get: () => undefined,
  } as unknown as ConfigService
}

function input(over: Partial<CompositeMatchInput> = {}): CompositeMatchInput {
  return {
    rawBarcode: null,
    rawTradeName: 'Цитрамон П',
    rawDosageForm: 'таблетки',
    rawDosageStrength: '500 мг',
    rawManufacturerName: 'Фармстандарт',
    ...over,
  }
}

describe('ResolveMedicineByCompositeUseCase (DTJ-097)', () => {
  let configService: ConfigService

  beforeEach(() => {
    configService = makeConfigService()
  })

  describe('Критерий приёмки #1: штрихкод → matched/barcode, fuzzy не вызывается', () => {
    it('rawBarcode совпал → matched, fuzzy-порт НЕ дёргался', async () => {
      const matcher = makeFuzzyMatcherMock({ barcodeId: 'm1', fuzzyCandidates: [] })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawBarcode: '4870123456789' }))

      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'barcode' })
      expect(matcher.findByBarcodeSpy).toHaveBeenCalledTimes(1)
      expect(matcher.findCandidatesByFuzzySpy).not.toHaveBeenCalled()
    })

    it('rawBarcode=null → fuzzy вызывается', async () => {
      const matcher = makeFuzzyMatcherMock({ barcodeId: null, fuzzyCandidates: [] })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawBarcode: null }))

      expect(matcher.findByBarcodeSpy).not.toHaveBeenCalled()
      expect(matcher.findCandidatesByFuzzySpy).toHaveBeenCalledTimes(1)
      expect(unwrap(result)).toEqual({ outcome: 'no_candidate' })
    })

    it('rawBarcode с внутренним префиксом 2 → fuzzy вызывается (D-06)', async () => {
      // '2001234567890' — формально валидный EAN-13 (последняя цифра — чек),
      // но внутренний префикс 2. `isGloballyIdentifiable()` вернёт false.
      const matcher = makeFuzzyMatcherMock({ barcodeId: null, fuzzyCandidates: [] })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      await useCase.execute(input({ rawBarcode: '2001234567890' }))

      expect(matcher.findByBarcodeSpy).not.toHaveBeenCalled()
      expect(matcher.findCandidatesByFuzzySpy).toHaveBeenCalledTimes(1)
    })

    it('rawBarcode невалидный (не EAN-13) → fuzzy вызывается', async () => {
      const matcher = makeFuzzyMatcherMock({ barcodeId: null, fuzzyCandidates: [] })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      await useCase.execute(input({ rawBarcode: 'not-a-barcode' }))

      expect(matcher.findByBarcodeSpy).not.toHaveBeenCalled()
      expect(matcher.findCandidatesByFuzzySpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Критерий приёмки #2: TC-INV-010 — нет кандидатов выше порога → no_candidate', () => {
    it('fuzzy вернул пустой массив → no_candidate', async () => {
      const matcher = makeFuzzyMatcherMock({ barcodeId: null, fuzzyCandidates: [] })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input())

      expect(unwrap(result)).toEqual({ outcome: 'no_candidate' })
    })
  })

  describe('Критерий приёмки #3: TC-INV-012 — топ-1 vs топ-2 ниже порога → ambiguous', () => {
    it('combined_score разница 0.02 < 0.05 → ambiguous, авто-выбор НЕ произошёл', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.4, dosageStrength: '500 мг' },
          { id: 'm2', combinedScore: 0.38, dosageStrength: '500 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input())
      const value = unwrap(result)

      expect(value.outcome).toBe('ambiguous')
      if (value.outcome === 'ambiguous') {
        expect(value.candidateIds).toEqual(['m1', 'm2'])
      }
    })

    it('combined_score разница 0.07 >= 0.05 → matched/fuzzy (топ-1 выбран)', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.45, dosageStrength: '500 мг' },
          { id: 'm2', combinedScore: 0.38, dosageStrength: '500 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input())

      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })

    it('ровно 1 финалист → matched/fuzzy', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.5, dosageStrength: '500 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input())

      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })
  })

  describe('Критерий приёмки #4: дозировка отбрасывает единственного кандидата', () => {
    it('top-1 похож (0.60), но dosage 250 мг против входных 500 мг → no_candidate', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.6, dosageStrength: '250 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawDosageStrength: '500 мг' }))

      expect(unwrap(result)).toEqual({ outcome: 'no_candidate' })
    })

    it('top-1 + top-2 похожи, оба с правильной дозировкой → matched', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.6, dosageStrength: '500 мг' },
          { id: 'm2', combinedScore: 0.59, dosageStrength: '500 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawDosageStrength: '500 мг' }))

      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })

    it('top-1 с правильной дозировкой + top-2 с неправильной → matched', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.6, dosageStrength: '500 мг' },
          { id: 'm2', combinedScore: 0.59, dosageStrength: '250 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawDosageStrength: '500 мг' }))

      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })

    it('эквивалентные единицы: 500 мг == 0.5 г → кандидат проходит постфильтр', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.5, dosageStrength: '0.5 г' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawDosageStrength: '500 мг' }))

      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })

    it('несопоставимые семейства: мг vs мл → кандидат отбрасывается', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.5, dosageStrength: '500 мл' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawDosageStrength: '500 мг' }))

      expect(unwrap(result)).toEqual({ outcome: 'no_candidate' })
    })

    it('rawDosageStrength=null → постфильтр пропускается (НЕ отбрасывает)', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.5, dosageStrength: '250 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawDosageStrength: null }))

      // Постфильтр пропущен → кандидат остаётся → matched/fuzzy.
      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })

    it('rawDosageStrength нераспарсиваемая строка → постфильтр пропускается', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.5, dosageStrength: '250 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawDosageStrength: 'двойная доза' }))

      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })

    it('кандидат без dosageStrength (null) пропускается постфильтром', async () => {
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.5, dosageStrength: null },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawDosageStrength: '500 мг' }))

      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })
  })

  describe('Валидация входа', () => {
    it('rawTradeName="" → InvalidCompositeMatchInputError', async () => {
      const matcher = makeFuzzyMatcherMock({ barcodeId: null, fuzzyCandidates: [] })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawTradeName: '' }))

      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(InvalidCompositeMatchInputError)
      }
      expect(matcher.findCandidatesByFuzzySpy).not.toHaveBeenCalled()
    })

    it('rawTradeName="   " (только пробелы) → InvalidCompositeMatchInputError', async () => {
      const matcher = makeFuzzyMatcherMock({ barcodeId: null, fuzzyCandidates: [] })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configService)

      const result = await useCase.execute(input({ rawTradeName: '   ' }))

      expect(isErr(result)).toBe(true)
    })
  })

  describe('Конфигурируемые пороги (DTJ-097 DoD §4)', () => {
    it('CATALOG_MATCH_AMBIGUITY_GAP=0.1 → больший разрыв нужен для matched', async () => {
      const configServiceWithGap = {
        get: (key: string) => (key === 'CATALOG_MATCH_AMBIGUITY_GAP' ? '0.1' : undefined),
      } as unknown as ConfigService
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.45, dosageStrength: '500 мг' },
          { id: 'm2', combinedScore: 0.38, dosageStrength: '500 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configServiceWithGap)

      // Разница 0.07 < 0.1 → ambiguous (с дефолтом 0.05 это было бы matched).
      const result = await useCase.execute(input())
      const value = unwrap(result)
      expect(value.outcome).toBe('ambiguous')
    })

    it('CATALOG_MATCH_AMBIGUITY_GAP="невалидно" → дефолт 0.05', async () => {
      const configServiceBad = {
        get: (key: string) => (key === 'CATALOG_MATCH_AMBIGUITY_GAP' ? 'banana' : undefined),
      } as unknown as ConfigService
      const matcher = makeFuzzyMatcherMock({
        barcodeId: null,
        fuzzyCandidates: [
          { id: 'm1', combinedScore: 0.45, dosageStrength: '500 мг' },
          { id: 'm2', combinedScore: 0.38, dosageStrength: '500 мг' },
        ],
      })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configServiceBad)

      // Разница 0.07 >= 0.05 → matched.
      const result = await useCase.execute(input())
      expect(unwrap(result)).toEqual({ outcome: 'matched', medicineId: 'm1', matchedVia: 'fuzzy' })
    })

    it('CATALOG_MATCH_FUZZY_LIMIT=3 → лимит пробрасывается в порт', async () => {
      const configServiceWithLimit = {
        get: (key: string) => (key === 'CATALOG_MATCH_FUZZY_LIMIT' ? '3' : undefined),
      } as unknown as ConfigService
      const matcher = makeFuzzyMatcherMock({ barcodeId: null, fuzzyCandidates: [] })
      const useCase = new ResolveMedicineByCompositeUseCase(matcher, configServiceWithLimit)

      await useCase.execute(input())

      expect(matcher.findCandidatesByFuzzySpy).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 3 }),
      )
    })
  })
})