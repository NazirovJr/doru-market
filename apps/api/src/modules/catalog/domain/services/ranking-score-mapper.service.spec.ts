import { describe, expect, it } from 'vitest'
import { DomainInvariantViolationError } from '../errors/domain-invariant-violation.error.js'
import {
  RankingScoreMapper,
  RANKING_WEIGHT_TEXT,
  RANKING_WEIGHT_AVAILABILITY,
  RANKING_WEIGHT_PROXIMITY,
  RANKING_WEIGHT_PRICE,
  RANKING_WEIGHT_RELIABILITY,
  AVAILABILITY_SATURATION_OFFERS,
  type RawRankingInput,
  type UsedRankingWeights,
} from './ranking-score-mapper.service.js'

// Допуск сравнения с примером §3.2 — ±0.001 (DTJ-183 «Риски»: плавающая точка, не строгое `===`).
const SCORE_COMPARISON_DECIMAL_DIGITS = 3

// Радиус/цена «нейтрального» входа: подобраны так, чтобы КАЖДАЯ компонента, кроме варьируемой
// в конкретном it(), давала ровно 0 — это позволяет изолированно проверять один сигнал за раз
// через публично наблюдаемый `finalScore`, не заглядывая во внутренности мэппера.
const BASELINE_RADIUS_METERS = 1000
const BASELINE_MAX_PRICE_DIRAM = 1000

const baselineInput = (overrides: Partial<RawRankingInput> = {}): RawRankingInput => ({
  textRelevance: 0,
  offersCountInRadius: 0,
  nearestOfferDistanceMeters: BASELINE_RADIUS_METERS, // = radius → proximityScore = 0
  radiusMeters: BASELINE_RADIUS_METERS,
  cheapestOfferPriceDiram: BASELINE_MAX_PRICE_DIRAM, // = maxPriceInPage → priceScore = 0
  minPriceInPage: 0,
  maxPriceInPage: BASELINE_MAX_PRICE_DIRAM,
  reliabilityValue: 0,
  ...overrides,
})

/** Строка таблицы регрессии перенормировки — именованный тип нужен `it.each<T>(...)` (без него
 *  дженерик-вывод из инлайн-типа массива деградирует до `any`, см. `pharmacy-opening-hours.policy.spec.ts`). */
interface RenormalizationCase {
  readonly label: string
  readonly overrides: Partial<RawRankingInput>
  readonly expectedWeights: UsedRankingWeights
}

const RANKING_COMPONENT_KEYS: readonly (keyof UsedRankingWeights)[] = [
  'text',
  'availability',
  'proximity',
  'price',
  'reliability',
]

const expectWeightsToMatch = (actual: UsedRankingWeights, expected: UsedRankingWeights): void => {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
  for (const key of Object.keys(expected) as (keyof UsedRankingWeights)[]) {
    expect(actual[key]).toBeCloseTo(expected[key]!, SCORE_COMPARISON_DECIMAL_DIGITS)
  }
}

describe('RankingScoreMapper.normalize', () => {
  const mapper = new RankingScoreMapper()

  it('baseline (все компоненты по нулю) даёт finalScore = 0 и полный набор весов', () => {
    const result = mapper.normalize(baselineInput())
    expect(result.finalScore).toBeCloseTo(0, SCORE_COMPARISON_DECIMAL_DIGITS)
    expectWeightsToMatch(result.usedWeights, {
      text: RANKING_WEIGHT_TEXT,
      availability: RANKING_WEIGHT_AVAILABILITY,
      proximity: RANKING_WEIGHT_PROXIMITY,
      price: RANKING_WEIGHT_PRICE,
      reliability: RANKING_WEIGHT_RELIABILITY,
    })
  })

  describe('§3.2 пример расчёта (SRS-CAT-020) — дословное воспроизведение', () => {
    it('AC1: finalScore = 0.770 ± 0.001 для входных величин примера', () => {
      const result = mapper.normalize({
        textRelevance: 0.525, // clamp((0.62-0.20)/0.80, 0, 1) — уже посчитано SQL-слоем
        offersCountInRadius: 4,
        nearestOfferDistanceMeters: 800,
        radiusMeters: 5000,
        cheapestOfferPriceDiram: 1200, // 12.00 TJS × 100 диram
        minPriceInPage: 1200, // единственный кандидат в примере
        maxPriceInPage: 1200,
        reliabilityValue: 4.2,
      })
      expect(result.finalScore).toBeCloseTo(0.77, SCORE_COMPARISON_DECIMAL_DIGITS)
    })
  })

  describe('текстовая релевантность — изолированный сигнал', () => {
    it('textRelevance=0.5 (остальное по нулю) → finalScore = 0.40×0.5 = 0.20', () => {
      const result = mapper.normalize(baselineInput({ textRelevance: 0.5 }))
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_TEXT * 0.5, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('принимает textRelevance = 0 (нижняя граница диапазона включительно)', () => {
      expect(() => mapper.normalize(baselineInput({ textRelevance: 0 }))).not.toThrow()
    })

    it('принимает textRelevance = 1 (верхняя граница диапазона включительно) → finalScore = 0.40', () => {
      const result = mapper.normalize(baselineInput({ textRelevance: 1 }))
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_TEXT, SCORE_COMPARISON_DECIMAL_DIGITS)
    })
  })

  describe('наличие товара — изолированный сигнал (min(offers/AVAILABILITY_SATURATION_OFFERS, 1))', () => {
    it('offersCountInRadius=0 («товара нет в наличии») → availabilityScore=0, finalScore=0', () => {
      const result = mapper.normalize(baselineInput({ offersCountInRadius: 0 }))
      expect(result.finalScore).toBeCloseTo(0, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('offersCountInRadius=1 (треть насыщения) → finalScore = 0.20 × (1/3)', () => {
      const result = mapper.normalize(baselineInput({ offersCountInRadius: 1 }))
      expect(result.finalScore).toBeCloseTo(
        RANKING_WEIGHT_AVAILABILITY * (1 / AVAILABILITY_SATURATION_OFFERS),
        SCORE_COMPARISON_DECIMAL_DIGITS,
      )
    })

    it('offersCountInRadius=AVAILABILITY_SATURATION_OFFERS (3) → насыщение, finalScore = 0.20', () => {
      const result = mapper.normalize(baselineInput({ offersCountInRadius: AVAILABILITY_SATURATION_OFFERS }))
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_AVAILABILITY, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('offersCountInRadius=6 (сверх насыщения) → клампится к 1.0, finalScore = 0.20 (не растёт дальше)', () => {
      const result = mapper.normalize(baselineInput({ offersCountInRadius: 6 }))
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_AVAILABILITY, SCORE_COMPARISON_DECIMAL_DIGITS)
    })
  })

  describe('близость к пользователю — изолированный сигнал', () => {
    it('дистанция = 0 (ближайшая точка) → proximityScore=1, finalScore = 0.15', () => {
      const result = mapper.normalize(baselineInput({ nearestOfferDistanceMeters: 0 }))
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_PROXIMITY, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('дистанция = половина радиуса → proximityScore=0.5, finalScore = 0.15×0.5', () => {
      const result = mapper.normalize(
        baselineInput({ nearestOfferDistanceMeters: BASELINE_RADIUS_METERS / 2 }),
      )
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_PROXIMITY * 0.5, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('дистанция = радиус (граница) → proximityScore=0, finalScore = 0', () => {
      const result = mapper.normalize(baselineInput({ nearestOfferDistanceMeters: BASELINE_RADIUS_METERS }))
      expect(result.finalScore).toBeCloseTo(0, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('дистанция за пределами радиуса клампится к proximityScore=0, не уходит в отрицательные', () => {
      const result = mapper.normalize(
        baselineInput({ nearestOfferDistanceMeters: BASELINE_RADIUS_METERS * 2 }),
      )
      expect(result.finalScore).toBeCloseTo(0, SCORE_COMPARISON_DECIMAL_DIGITS)
    })
  })

  describe('нет геолокации (SRS-CAT-022) — proximityScore структурно исключён, веса перенормированы', () => {
    it('AC2: nearestOfferDistanceMeters=null → веса {text:0.471, availability:0.235, price:0.176, reliability:0.118}, proximity отсутствует', () => {
      const result = mapper.normalize(baselineInput({ nearestOfferDistanceMeters: null }))
      expectWeightsToMatch(result.usedWeights, {
        text: 0.471,
        availability: 0.235,
        price: 0.176,
        reliability: 0.118,
      })
      expect(result.usedWeights.proximity).toBeUndefined()
    })

    it('без гео radiusMeters игнорируется (не участвует в вычислении, деление не происходит)', () => {
      expect(() =>
        mapper.normalize(baselineInput({ nearestOfferDistanceMeters: null, radiusMeters: 0 })),
      ).not.toThrow()
    })
  })

  describe('таблица перенормировки — 6 комбинаций (регрессия SRS-CAT-022)', () => {
    const RENORMALIZATION_CASES: readonly RenormalizationCase[] = [
      {
        label: 'гео есть, нейтральные величины — полный набор весов',
        overrides: {},
        expectedWeights: {
          text: RANKING_WEIGHT_TEXT,
          availability: RANKING_WEIGHT_AVAILABILITY,
          proximity: RANKING_WEIGHT_PROXIMITY,
          price: RANKING_WEIGHT_PRICE,
          reliability: RANKING_WEIGHT_RELIABILITY,
        },
      },
      {
        label: 'гео есть, дистанция=0, большой разброс других величин — веса те же (независимы от значений)',
        overrides: {
          nearestOfferDistanceMeters: 0,
          offersCountInRadius: 25,
          reliabilityValue: 5,
          cheapestOfferPriceDiram: 0,
          minPriceInPage: 0,
          maxPriceInPage: 2000,
        },
        expectedWeights: {
          text: RANKING_WEIGHT_TEXT,
          availability: RANKING_WEIGHT_AVAILABILITY,
          proximity: RANKING_WEIGHT_PROXIMITY,
          price: RANKING_WEIGHT_PRICE,
          reliability: RANKING_WEIGHT_RELIABILITY,
        },
      },
      {
        label: 'гео есть, textRelevance=1 — полный набор весов не зависит от текстовой релевантности',
        overrides: { textRelevance: 1 },
        expectedWeights: {
          text: RANKING_WEIGHT_TEXT,
          availability: RANKING_WEIGHT_AVAILABILITY,
          proximity: RANKING_WEIGHT_PROXIMITY,
          price: RANKING_WEIGHT_PRICE,
          reliability: RANKING_WEIGHT_RELIABILITY,
        },
      },
      {
        label: 'гео отсутствует, нейтральные величины — перенормированные веса',
        overrides: { nearestOfferDistanceMeters: null },
        expectedWeights: { text: 0.471, availability: 0.235, price: 0.176, reliability: 0.118 },
      },
      {
        label: 'гео отсутствует, большой разброс других величин — те же перенормированные веса',
        overrides: {
          nearestOfferDistanceMeters: null,
          offersCountInRadius: 25,
          reliabilityValue: 5,
          cheapestOfferPriceDiram: 0,
          minPriceInPage: 0,
          maxPriceInPage: 2000,
        },
        expectedWeights: { text: 0.471, availability: 0.235, price: 0.176, reliability: 0.118 },
      },
      {
        label:
          'гео отсутствует + вырожденная единая цена страницы — перенормировка и priceScore=1 одновременно',
        overrides: {
          nearestOfferDistanceMeters: null,
          cheapestOfferPriceDiram: 500,
          minPriceInPage: 500,
          maxPriceInPage: 500,
        },
        expectedWeights: { text: 0.471, availability: 0.235, price: 0.176, reliability: 0.118 },
      },
    ]

    it.each<RenormalizationCase>(RENORMALIZATION_CASES)('$label', ({ overrides, expectedWeights }) => {
      const result = mapper.normalize(baselineInput(overrides))
      expectWeightsToMatch(result.usedWeights, expectedWeights)
      // `Object.values` на интерфейсе без индексной сигнатуры типизируется как `any[]`
      // (квирк lib.es2017), поэтому суммируем по явному списку известных ключей.
      const weightsSum = RANKING_COMPONENT_KEYS.reduce((sum, key) => sum + (result.usedWeights[key] ?? 0), 0)
      expect(weightsSum).toBeCloseTo(1, SCORE_COMPARISON_DECIMAL_DIGITS)
    })
  })

  describe('цена — изолированный сигнал и вырожденный случай (SRS-CAT-021)', () => {
    it('cheapestOfferPriceDiram = minPriceInPage → priceScore=1, finalScore = 0.15', () => {
      const result = mapper.normalize(baselineInput({ cheapestOfferPriceDiram: 0 }))
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_PRICE, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('цена ровно посередине min/max → priceScore=0.5, finalScore = 0.15×0.5', () => {
      const result = mapper.normalize(
        baselineInput({ cheapestOfferPriceDiram: BASELINE_MAX_PRICE_DIRAM / 2 }),
      )
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_PRICE * 0.5, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('AC3: maxPriceInPage === minPriceInPage → priceScore=1.0 для этого элемента (не NaN/null)', () => {
      const result = mapper.normalize(
        baselineInput({ cheapestOfferPriceDiram: 1200, minPriceInPage: 1200, maxPriceInPage: 1200 }),
      )
      expect(Number.isNaN(result.finalScore)).toBe(false)
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_PRICE, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('вырожденный случай игнорирует cheapestOfferPriceDiram — ветка не делит на ноль ни при какой цене', () => {
      const result = mapper.normalize(
        baselineInput({ cheapestOfferPriceDiram: 999_999, minPriceInPage: 500, maxPriceInPage: 500 }),
      )
      expect(Number.isFinite(result.finalScore)).toBe(true)
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_PRICE, SCORE_COMPARISON_DECIMAL_DIGITS)
    })
  })

  describe('надёжность аптеки — изолированный сигнал (reliabilityValue / 5.0)', () => {
    it('reliabilityValue=5 (максимум шкалы) → reliabilityScore=1, finalScore = 0.10', () => {
      const result = mapper.normalize(baselineInput({ reliabilityValue: 5 }))
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_RELIABILITY, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('reliabilityValue=3.5 (SQL-дефолт §14.1 для новой аптеки) → finalScore = 0.10×0.7', () => {
      const result = mapper.normalize(baselineInput({ reliabilityValue: 3.5 }))
      expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_RELIABILITY * 0.7, SCORE_COMPARISON_DECIMAL_DIGITS)
    })

    it('reliabilityValue=4.2 (пример §3.2) → finalScore = 0.10×0.84', () => {
      const result = mapper.normalize(baselineInput({ reliabilityValue: 4.2 }))
      expect(result.finalScore).toBeCloseTo(
        RANKING_WEIGHT_RELIABILITY * 0.84,
        SCORE_COMPARISON_DECIMAL_DIGITS,
      )
    })
  })

  describe('defensive-проверки — негативные сценарии (defense-in-depth против дефектов SQL-слоя)', () => {
    it('AC4: textRelevance=1.3 (вне [0,1]) → бросает DomainInvariantViolationError', () => {
      expect(() => mapper.normalize(baselineInput({ textRelevance: 1.3 }))).toThrow(
        DomainInvariantViolationError,
      )
    })

    it('textRelevance=-0.001 (ниже нижней границы) → бросает DomainInvariantViolationError', () => {
      expect(() => mapper.normalize(baselineInput({ textRelevance: -0.001 }))).toThrow(
        DomainInvariantViolationError,
      )
    })

    it('сообщение ошибки называет нарушившее поле, полезно для диагностики', () => {
      expect(() => mapper.normalize(baselineInput({ textRelevance: 1.3 }))).toThrow(/textRelevance/)
    })

    it('reliabilityValue=null (DTJ-185 забыл COALESCE) → бросает DomainInvariantViolationError', () => {
      expect(() => mapper.normalize(baselineInput({ reliabilityValue: null }))).toThrow(
        DomainInvariantViolationError,
      )
    })
  })
})

describe('RankingScoreMapper.forCategoryBrowsing (SRS-CAT-023)', () => {
  const mapper = new RankingScoreMapper()

  it('textRelevance принудительно 1.0: при гео и нейтральных остальных величинах finalScore = 0.40', () => {
    const { textRelevance: _unused, ...rest } = baselineInput()
    const result = mapper.forCategoryBrowsing(rest)
    expect(result.finalScore).toBeCloseTo(RANKING_WEIGHT_TEXT, SCORE_COMPARISON_DECIMAL_DIGITS)
  })

  it('взаимодействует с перенормировкой: без гео forced-текст получает renormalized-вес ≈0.471', () => {
    const { textRelevance: _unused, ...rest } = baselineInput({ nearestOfferDistanceMeters: null })
    const result = mapper.forCategoryBrowsing(rest)
    expect(result.finalScore).toBeCloseTo(0.471, SCORE_COMPARISON_DECIMAL_DIGITS)
    expect(result.usedWeights.proximity).toBeUndefined()
  })

  it('остальные компоненты считаются как обычно, а не тоже форсируются', () => {
    const { textRelevance: _unused, ...rest } = baselineInput({
      offersCountInRadius: AVAILABILITY_SATURATION_OFFERS,
    })
    const result = mapper.forCategoryBrowsing(rest)
    // textRelevance(forced=1)×0.40 + availability(saturated=1)×0.20 = 0.60
    expect(result.finalScore).toBeCloseTo(
      RANKING_WEIGHT_TEXT + RANKING_WEIGHT_AVAILABILITY,
      SCORE_COMPARISON_DECIMAL_DIGITS,
    )
  })
})
