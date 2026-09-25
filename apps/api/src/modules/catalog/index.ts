/**
 * Публичный фасад модуля `catalog` (EP-04, DTJ-090, наполняется в DTJ-096).
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2: единственный легальный путь
 * межмодульного взаимодействия для чужих bounded contexts. Импорт
 * `modules/catalog/domain|application|infrastructure|presentation` напрямую —
 * блокирующее нарушение (проверяется `dependency-cruiser` правилом
 * `no-cross-module-deep-import`).
 */
import type { MedicineSnapshot } from './domain/medicine.types.js'
import type { SubstanceRef } from './domain/medicine.types.js'
import type { MedicineRecord } from './domain/medicine.types.js'
import type { CatalogRepository } from './application/ports/catalog-repository.port.js'
import { CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE } from './domain/medicine.enums.js'
import { Inject, Injectable } from '@nestjs/common'
import type { PharmacyOfferPublic } from '@dorutj/contracts'
import { SEARCH_DEFAULT_RADIUS_METERS } from '@dorutj/contracts'
import { CATALOG_REPOSITORY } from './application/ports/catalog-repository.port.js'
import { ResolveMedicineByCompositeUseCase } from './application/use-cases/resolve-medicine-by-composite.use-case.js'
import {
  ANALOG_OFFER_LOOKUP_PORT,
  type AnalogOfferLookupPort,
} from './application/ports/analog-offer-lookup.port.js'

// Определения этих двух типов переехали в `application/ports/composite-match.types.ts`:
// иначе получался цикл `resolve-medicine-by-composite.use-case.ts → index.ts → он же`,
// на котором падал гейт `no-circular` в arch:check. Ре-экспорт сохраняет публичный API
// барреля — все существующие импортёры продолжают брать типы отсюда.
import type { CompositeMatchInput, MedicineMatchResult } from './application/ports/composite-match.types.js'
export type { CompositeMatchInput, MedicineMatchResult }

/**
 * `CatalogFacade` (DTJ-096): контракт модуля для чужих контекстов. Реализация
 * добавляется в DTJ-096 (первые 3 метода) и DTJ-097 (`resolveMedicineByComposite`).
 */
export interface CatalogFacade {
  getMedicineSnapshot(ids: readonly string[]): Promise<Map<string, MedicineSnapshot>>
  getSubstances(ids: readonly string[]): Promise<Map<string, SubstanceRef[]>>
  isVisible(medicineId: string): Promise<boolean>
  resolveMedicineByComposite(input: CompositeMatchInput): Promise<MedicineMatchResult>
  /** DTJ-385: серверная экономия для пары (референс, аналог) — та же цена, что видит `FindAnalogsUseCase`. */
  computeAnalogSavingsDiram(input: AnalogSavingsComputeInput): Promise<number | null>
}

/** Вход `computeAnalogSavingsDiram` (DTJ-385). `pharmacyId` — сузить до цены конкретной аптеки. */
export interface AnalogSavingsComputeInput {
  readonly referenceMedicineId: string
  readonly analogMedicineId: string
  readonly pharmacyId?: string
}

/** DI-токен для провайдера `CatalogFacade` (DTJ-096: `{ provide: CATALOG_FACADE, useClass: ... }`). */
export const CATALOG_FACADE = Symbol('@dorutj/catalog/CatalogFacade')

/** Доменные события, которые модуль публикует (DTJ-093, реэкспорт через фасад). */
export interface MedicinePublishedEvent {
  readonly medicineId: string
  readonly publishedAt: string
}

export interface NewControlCategoryCandidateEvent {
  readonly medicineId: string
  readonly proposedCategory: string
  readonly actorId: string
  readonly proposedAt: string
}

/**
 * Реализация `CatalogFacade` (DTJ-096).
 *
 * Использует `CatalogRepository` для доступа к данным. Не содержит бизнес-логики,
 * только делегирует к репозиторию и применяет правила видимости (SRS-CAT-064).
 */
@Injectable()
export class CatalogFacadeImpl implements CatalogFacade {
  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
    // Явный @Inject: без него параметр не попадает в paramtypes (esbuild не эмитит
    // `design:paramtypes`, DTJ-001), фасад создаётся с одним аргументом, и поле молча
    // остаётся undefined — бут зелёный, TypeError на первом же вызове через фасад.
    @Inject(ResolveMedicineByCompositeUseCase)
    private readonly resolveMedicineByCompositeUseCase: ResolveMedicineByCompositeUseCase,
    @Inject(ANALOG_OFFER_LOOKUP_PORT)
    private readonly analogOfferLookup: AnalogOfferLookupPort,
  ) {}

  /**
   * Возвращает снимки препаратов для заказов (D-06/SRS-DOM-107).
   * Несуществующие id молча пропускаются — снапшот для orders не обязан
   * знать про existence-проверку, это ответственность `orders`, вызывающего
   * с уже валидными `id` из корзины.
   */
  async getMedicineSnapshot(ids: readonly string[]): Promise<Map<string, MedicineSnapshot>> {
    if (ids.length === 0) return new Map()
    const records = await this.catalogRepository.findMedicinesByIds(ids)
    const out = new Map<string, MedicineSnapshot>()
    for (const record of records) {
      out.set(record.id, this.recordToSnapshot(record))
    }
    return out
  }

  /**
   * Возвращает действующие вещества препаратов (SRS-CAT-051).
   * Прямой проброс формы данных — частичное пересечение вычисляет ВЫЗЫВАЮЩИЙ
   * модуль `orders`, не `catalog`.
   */
  async getSubstances(ids: readonly string[]): Promise<Map<string, SubstanceRef[]>> {
    if (ids.length === 0) return new Map()
    const substancesMap = await this.catalogRepository.findSubstancesByMedicineIds(ids)
    // Преобразуем ReadonlyMap<string, readonly SubstanceRef[]> в Map<string, SubstanceRef[]>
    const out = new Map<string, SubstanceRef[]>()
    for (const [key, value] of substancesMap) {
      out.set(key, [...value]) // создаём копию массива без readonly
    }
    return out
  }

  /**
   * Проверяет видимость препарата для публичного доступа (SRS-CAT-064).
   * Видим только если опубликован И controlCategory не в {psychotropic, narcotic}.
   * Переиспользует те же условия, что DTJ-095 (GetMedicineDetailUseCase),
   * через общую приватную функцию.
   */
  async isVisible(medicineId: string): Promise<boolean> {
    const record = await this.catalogRepository.findMedicineById(medicineId)
    if (record === null) return false
    return isPubliclyVisible(record)
  }

  /**
   * Проброс composite-матчинга на `ResolveMedicineByCompositeUseCase` (DTJ-097).
   * Use case возвращает `Result` — здесь он разворачивается: `err` перебрасывается
   * как исключение, т.к. контракт `CatalogFacade.resolveMedicineByComposite`
   * (см. интерфейс выше) объявлен через `Promise<MedicineMatchResult>`, без `Result`.
   */
  async resolveMedicineByComposite(input: CompositeMatchInput): Promise<MedicineMatchResult> {
    const result = await this.resolveMedicineByCompositeUseCase.execute(input)
    if (!result.ok) {
      throw result.error
    }
    return result.value
  }

  /**
   * DTJ-385: сервер сам считает экономию analog_shown/added_to_cart — та же пара
   * офферов (`ANALOG_OFFER_LOOKUP_PORT`) и то же правило diff, что `FindAnalogsUseCase`,
   * без домен-фильтра эквивалентности (пара уже определена вызывающим).
   */
  async computeAnalogSavingsDiram(input: AnalogSavingsComputeInput): Promise<number | null> {
    if (input.referenceMedicineId === input.analogMedicineId) return null
    const offerMap = await this.analogOfferLookup.getOffersForMedicines({
      medicineIds: [input.referenceMedicineId, input.analogMedicineId],
      radiusMeters: SEARCH_DEFAULT_RADIUS_METERS,
    })
    const referencePrice = cheapestPriceDiram(offerMap.get(input.referenceMedicineId), input.pharmacyId)
    const analogPrice = cheapestPriceDiram(offerMap.get(input.analogMedicineId), input.pharmacyId)
    if (referencePrice === null || analogPrice === null) return null
    const diff = referencePrice - analogPrice
    return diff > 0 ? diff : null
  }

  private recordToSnapshot(record: MedicineRecord): MedicineSnapshot {
    return {
      medicineId: record.id,
      tradeName: record.tradeName,
      innName: record.innName,
      dosageForm: record.dosageForm,
      dosageStrength: record.dosageStrength,
      isPrescriptionRequired: record.isPrescriptionRequired,
      controlCategory: record.controlCategory,
    }
  }
}

/**
 * Общая функция проверки публичной видимости (C15 — не дублировать правило
 * в `isVisible` и `GetMedicineDetailUseCase`).
 * Видим если: isPublished === true И controlCategory НЕ в {psychotropic, narcotic}.
 */
function isPubliclyVisible(record: MedicineRecord): boolean {
  return record.isPublished && !CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(record.controlCategory)
}

// Офферы уже отсортированы по цене портом (SRS-DOM-158) — фильтр по аптеке сохраняет порядок.
function cheapestPriceDiram(
  offers: readonly PharmacyOfferPublic[] | undefined,
  pharmacyId: string | undefined,
): number | null {
  if (offers === undefined) return null
  const matching = pharmacyId === undefined ? offers : offers.filter((o) => o.pharmacyId === pharmacyId)
  return matching[0]?.priceDiram ?? null
}
