/**
 * `RankingScoreMapper` (EP-06 «Умный поиск + ранжирование + автодополнение», DTJ-183).
 * ЕДИНСТВЕННОЕ место в кодовой базе, где композитная формула ранжирования выдачи
 * (`SRS-CAT-018`) СЧИТАЕТСЯ окончательно. SQL-заготовка `PostgresSearchProvider.search()`
 * (DTJ-185, `20-module-catalog-search.md` §3.3) поставляет только сырые компоненты и
 * намеренно оставляет вырожденные случаи (единая цена на странице → `NULL`) НЕ добитыми —
 * финальная нормализация, `COALESCE`-замена и перенормировка весов происходят здесь.
 *
 * Чистая функция без I/O (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.6): принимает уже
 * вычисленные величины (текстовая релевантность из SQL, количество офферов, дистанции, цены,
 * reliability), НЕ читает `pharmacy_reliability_scores` и БД вообще. Юнит-тестируется полностью
 * без БД, порог покрытия `domain/` ≥90% (`02` §6, `09` тикета).
 *
 * Вызывается как последний шаг мэппинга строки БД → `SearchResultItem` из
 * `PostgresSearchProvider` (DTJ-185) и из `SearchMedicinesUseCase` (DTJ-188, browsing-режим
 * без текста через `forCategoryBrowsing`).
 *
 * @see docs/spec/20-module-catalog-search.md §3 (SRS-CAT-018..023)
 * @see tickets/ep05-search-map/DTJ-183.md
 */
import { DomainInvariantViolationError } from '../errors/domain-invariant-violation.error.js'

/** SRS-CAT-018 §3.1: вес компоненты текстовой релевантности в композитной формуле. */
export const RANKING_WEIGHT_TEXT = 0.4
/** SRS-CAT-018 §3.1: вес компоненты наличия товара в радиусе поиска. */
export const RANKING_WEIGHT_AVAILABILITY = 0.2
/** SRS-CAT-018 §3.1: вес компоненты близости ближайшего оффера к пользователю. */
export const RANKING_WEIGHT_PROXIMITY = 0.15
/** SRS-CAT-018 §3.1: вес компоненты цены (min-max нормализация внутри страницы результатов). */
export const RANKING_WEIGHT_PRICE = 0.15
/** SRS-CAT-018 §3.1: вес компоненты операционной надёжности аптеки самого дешёвого оффера. */
export const RANKING_WEIGHT_RELIABILITY = 0.1

/**
 * SRS-CAT-018 §3.1 (ASSUMPTION спеки): число офферов в радиусе, при котором
 * `availabilityScore` насыщается до `1.0` — дальнейший рост числа предложений не добавляет веса.
 */
export const AVAILABILITY_SATURATION_OFFERS = 3

/** §14.1: шкала операционной надёжности аптеки — `0..RELIABILITY_SCALE_MAX`. */
export const RELIABILITY_SCALE_MAX = 5

/**
 * SRS-CAT-023: в режиме браузинга категории без текстового запроса `textRelevance`
 * принудительно максимален для ВСЕХ кандидатов — компонента не различает результаты,
 * не потому что релевантность идеальна, а потому что сравнивать нечего.
 */
export const FORCED_TEXT_RELEVANCE_FOR_BROWSING = 1

/** Сырые величины, уже вычисленные вызывающим слоем (SQL/application), без единиц измерения. */
export interface RawRankingInput {
  /** SRS-CAT-019: уже посчитана SQL-слоем, диапазон `[0,1]`. Здесь только участвует в сумме. */
  readonly textRelevance: number
  /** Число офферов ЭТОГО медикамента в радиусе поиска (`pharmacy_inventory`, `ST_DWithin`). */
  readonly offersCountInRadius: number
  /**
   * Дистанция до ближайшего оффера в метрах. `null` — `geo` не передан клиентом (SRS-CAT-022):
   * `proximityScore` структурно ИСКЛЮЧАЕТСЯ из формулы, а не считается `0`.
   */
  readonly nearestOfferDistanceMeters: number | null
  /** Радиус поиска в метрах — знаменатель `proximityScore`. Не используется при `geo` отсутствии. */
  readonly radiusMeters: number
  /** Цена самого дешёвого оффера ЭТОГО медикамента, целые диram (D-06, Money-конвенция). */
  readonly cheapestOfferPriceDiram: number
  /** Минимальная цена среди ВСЕХ элементов текущей страницы результатов, диram. */
  readonly minPriceInPage: number
  /** Максимальная цена среди ВСЕХ элементов текущей страницы результатов, диram. */
  readonly maxPriceInPage: number
  /**
   * Надёжность аптеки-держателя самого дешёвого оффера, шкала `0..5`. SQL-слой обязан
   * подставить дефолт `3.5` через `COALESCE` (§14.1) ДО вызова этого сервиса — компонента
   * НИКОГДА не исключается структурно, в отличие от `proximityScore`. `null` здесь — дефект
   * вышестоящего SQL-слоя (забытый `COALESCE`), а не легитимное «нет данных»: defensive-проверка
   * бросает `DomainInvariantViolationError` (DTJ-183 «Риски и подводные камни»).
   */
  readonly reliabilityValue: number | null
}

/**
 * Веса, реально использованные при расчёте `finalScore` (уже перенормированные при отсутствии
 * структурных компонент). Для отладки/аналитики, НЕ для UI (`SRS-CAT-011` комментарий
 * `relevanceScore`). Ключ отсутствует — значит компонента была структурно исключена.
 */
export interface UsedRankingWeights {
  readonly text?: number
  readonly availability?: number
  readonly proximity?: number
  readonly price?: number
  readonly reliability?: number
}

export interface RankingResult {
  readonly finalScore: number
  readonly usedWeights: UsedRankingWeights
}

/** Внутреннее представление одной компоненты формулы. `value: null` = структурно отсутствует. */
interface RankingSignal {
  readonly key: keyof UsedRankingWeights
  readonly weight: number
  readonly value: number | null
}

export class RankingScoreMapper {
  /**
   * SRS-CAT-018: считает `finalScore` и веса, реально использованные после перенормировки
   * (SRS-CAT-022). Пример расчёта — `20-module-catalog-search.md` §3.2 (`SRS-CAT-020`).
   */
  public normalize(input: RawRankingInput): RankingResult {
    this.assertTextRelevanceInRange(input.textRelevance)
    const reliabilityValue = this.ensureReliabilityValuePresent(input.reliabilityValue)

    const signals: readonly RankingSignal[] = [
      { key: 'text', weight: RANKING_WEIGHT_TEXT, value: input.textRelevance },
      {
        key: 'availability',
        weight: RANKING_WEIGHT_AVAILABILITY,
        value: this.computeAvailabilityScore(input.offersCountInRadius),
      },
      {
        key: 'proximity',
        weight: RANKING_WEIGHT_PROXIMITY,
        value: this.computeProximityScore(input.nearestOfferDistanceMeters, input.radiusMeters),
      },
      {
        key: 'price',
        weight: RANKING_WEIGHT_PRICE,
        value: this.computePriceScore(
          input.cheapestOfferPriceDiram,
          input.minPriceInPage,
          input.maxPriceInPage,
        ),
      },
      {
        key: 'reliability',
        weight: RANKING_WEIGHT_RELIABILITY,
        value: this.computeReliabilityScore(reliabilityValue),
      },
    ]

    return this.combineSignals(signals)
  }

  /**
   * SRS-CAT-023: `textRelevance` принудительно `FORCED_TEXT_RELEVANCE_FOR_BROWSING` для ВСЕХ
   * кандидатов — режим браузинга категории без текста. `Omit` в сигнатуре делает подмену
   * `textRelevance` вызывающим кодом структурно невозможной (не runtime-проверка, а тип).
   * Остальные компоненты считаются как обычно. Сортировка — вне scope этого сервиса.
   */
  public forCategoryBrowsing(input: Omit<RawRankingInput, 'textRelevance'>): RankingResult {
    return this.normalize({ ...input, textRelevance: FORCED_TEXT_RELEVANCE_FOR_BROWSING })
  }

  private assertTextRelevanceInRange(textRelevance: number): void {
    if (!(textRelevance >= 0 && textRelevance <= 1)) {
      throw new DomainInvariantViolationError(
        `textRelevance must be within [0,1], got ${String(textRelevance)} — SRS-CAT-019 contract ` +
          'violated by the SQL layer (defense-in-depth, DTJ-183)',
      )
    }
  }

  private ensureReliabilityValuePresent(reliabilityValue: number | null): number {
    if (reliabilityValue === null) {
      throw new DomainInvariantViolationError(
        'reliabilityValue is null — the SQL layer must COALESCE it to the 3.5 default (§14.1) ' +
          'before calling RankingScoreMapper (defense-in-depth, DTJ-183 «Риски и подводные камни»)',
      )
    }
    return reliabilityValue
  }

  private computeAvailabilityScore(offersCountInRadius: number): number {
    return Math.min(offersCountInRadius / AVAILABILITY_SATURATION_OFFERS, 1)
  }

  private computeProximityScore(distanceMeters: number | null, radiusMeters: number): number | null {
    if (distanceMeters === null) {
      return null
    }
    return 1 - Math.min(distanceMeters / radiusMeters, 1)
  }

  private computePriceScore(
    cheapestPriceDiram: number,
    minPriceInPage: number,
    maxPriceInPage: number,
  ): number {
    // Вырожденный случай (SRS-CAT-021 примечание): одна уникальная цена на странице →
    // деление на ноль в SQL-заготовке даёт NULL, здесь заменяется на 1.0 для ВСЕХ элементов.
    if (maxPriceInPage === minPriceInPage) {
      return 1
    }
    return 1 - (cheapestPriceDiram - minPriceInPage) / (maxPriceInPage - minPriceInPage)
  }

  private computeReliabilityScore(reliabilityValue: number): number {
    return reliabilityValue / RELIABILITY_SCALE_MAX
  }

  /**
   * SRS-CAT-022: ОБЩЕЕ правило перенормировки — не частный случай `proximityScore`. Вес
   * каждого структурно отсутствующего сигнала (`value === null`) исключается из суммы, веса
   * присутствующих сигналов делятся на `(1 - Σ исключённых весов)`, так что их сумма снова
   * равна 1. Расширяемо: шестая компонента потребует только добавления в массив `signals`
   * вызывающим методом, этот метод править не придётся.
   */
  private combineSignals(signals: readonly RankingSignal[]): RankingResult {
    const excludedWeight = signals
      .filter((signal) => signal.value === null)
      .reduce((sum, signal) => sum + signal.weight, 0)
    const renormalizationFactor = 1 / (1 - excludedWeight)

    const presentSignals = signals.filter(
      (signal): signal is RankingSignal & { readonly value: number } => signal.value !== null,
    )

    const usedWeights = presentSignals.reduce<UsedRankingWeights>(
      (weights, signal) => ({ ...weights, [signal.key]: signal.weight * renormalizationFactor }),
      {},
    )
    const finalScore = presentSignals.reduce(
      (sum, signal) => sum + signal.weight * renormalizationFactor * signal.value,
      0,
    )

    return { finalScore, usedWeights }
  }
}
