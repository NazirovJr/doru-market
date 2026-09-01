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

/** Сигнатура composite-матчинга (SRS-INV-019..026, наполняется в DTJ-097). */
export interface CompositeMatchInput {
  readonly rawBarcode: string | null
  readonly rawTradeName: string
  readonly rawDosageForm: string | null
  readonly rawDosageStrength: string | null
  readonly rawManufacturerName: string | null
}

export type MedicineMatchResult =
  | { readonly outcome: 'matched'; readonly medicineId: string; readonly matchedVia: 'barcode' | 'fuzzy' }
  | { readonly outcome: 'ambiguous'; readonly candidateIds: readonly string[] }
  | { readonly outcome: 'no_candidate' }

/**
 * `CatalogFacade` (DTJ-096): контракт модуля для чужих контекстов. Реализация
 * добавляется в DTJ-096 (первые 3 метода) и DTJ-097 (`resolveMedicineByComposite`).
 */
export interface CatalogFacade {
  getMedicineSnapshot(ids: readonly string[]): Promise<Map<string, MedicineSnapshot>>
  getSubstances(ids: readonly string[]): Promise<Map<string, SubstanceRef[]>>
  isVisible(medicineId: string): Promise<boolean>
  resolveMedicineByComposite(input: CompositeMatchInput): Promise<MedicineMatchResult>
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
export class CatalogFacadeImpl implements CatalogFacade {
  constructor(
    private readonly catalogRepository: CatalogRepository,
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
   * Заглушка для DTJ-097 (composite-матчинг).
   * Реализуется в отдельном тикете DTJ-097.
   */
  resolveMedicineByComposite(_input: CompositeMatchInput): Promise<MedicineMatchResult> {
    // TODO(DTJ-097): реализовать composite-матчинг (точная проверка штрихкода +
    // trigram fuzzy + постфильтр по дозировке, D-06)
    return Promise.reject(new Error('resolveMedicineByComposite not implemented yet (DTJ-097)'))
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
