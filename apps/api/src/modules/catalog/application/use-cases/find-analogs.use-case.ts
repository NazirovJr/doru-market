/**
 * `FindAnalogsUseCase` (DTJ-101, EP-07, R1) — оркестратор подбора аналогов.
 *
 * Это **единственный** use case, которому нужны данные ДВУХ чужих контекстов
 * (`inventory` — цена/остаток; `onboarding` — активность аптеки/сети) одновременно
 * для КАЖДОГО кандидата — архитектурно самый сложный тикет эпика.
 *
 * **Пайплайн (9 шагов из тикета, дословно).**
 *
 *   1. `CatalogRepository.findMedicineById(medicineId)` → `referenceRecord`;
 *      not found / not visible / `controlCategory ∈ {psychotropic, narcotic}`
 *      → `MedicineNotFoundError` (404 на HTTP, см. DTJ-095).
 *   2. `AnalogCandidatesRepository.findCandidates(medicineId, ANALOG_CANDIDATES_LIMIT)`
 *      — SQL-предфильтр top-50 по множеству веществ + форме + видимости
 *      (DTJ-100). `Array.isArray` гарантирует, что result — массив id.
 *   3. `CatalogRepository.findMedicinesByIds(candidateIds)` → полные агрегаты
 *      `MedicineRecord[]` для дальнейшего доменного фильтра (шаг 4).
 *   4. `candidates.filter(c => analogEquivalenceService.isAnalog(reference, c))`
 *      — АВТОРИТЕТНОЕ решение. SQL-предфильтр (шаг 2) — только оптимизация,
 *      его «лишние» кандидаты отбрасываются здесь (SRS-CAT-043).
 *   5. `AnalogOfferLookupPort.getOffersForMedicines({ medicineIds: [referenceId,
 *      ...confirmedIds], geo, radiusMeters })`. Референс ВКЛЮЧАЕТСЯ в ОДИН
 *      батч-вызов, не отдельный (C15/производительность, шаг 7 тикета).
 *   6. Оставляем только аналоги с `offers.length > 0` (`stock_quantity > 0`
 *      гарантирован портом). Внутри каждого `medicineId` массив уже
 *      отсортирован портом по `priceDiram ASC` (SRS-DOM-158); мы дополнительно
 *      сортируем ИТОГОВЫЙ список по `cheapestOffer.priceDiram ASC`.
 *   7. `cheapestAnalog = items[0]`. `referenceDisplayPrice = cheapest
 *      offer референса`. `savingsDiram = referenceDisplayPrice -
 *      cheapestAnalog.displayPrice` — НЕ округляется (SRS-DOM-159, целые дирамы).
 *      Если у референса нет офферов или `savingsDiram <= 0` → `savings: null`,
 *      список всё равно непустой при `items.length > 0` (TC-CAT-014).
 *   8. `limit` (опционально, дефолт — без ограничения) обрезает items ПОСЛЕ
 *      сортировки по цене (шаг 9 тикета). `GetMedicineDetailUseCase` (DTJ-095)
 *      вызывает с `limit: 1` для `hasAnalogs`.
 *
 * **Безопасный заглушечный режим.** Сейчас `NullAnalogOfferLookupAdapter`
 * возвращает пустой `Map` — поэтому ВСЕГДА `items: []`, `savings: null`.
 * Поведение консистентно с заглушкой `hasAnalogs: false` в
 * `GetMedicineDetailUseCase` и НЕ вводит внешнего наблюдателя в заблуждение.
 * Реальная реализация порта (см. `analog-offer-lookup.adapter.ts`) заменит
 * заглушку через DI-биндинг без правок этого файла.
 *
 * **Граница модуля.** Use case зависит ТОЛЬКО от:
 *   - `CatalogRepository` (DTJ-092, application-port, catalog-owned);
 *   - `AnalogCandidatesRepository` (DTJ-100, application-port, catalog-owned);
 *   - `AnalogOfferLookupPort` (этот тикет, application-port, контракт — здесь);
 *   - `AnalogEquivalenceService` (DTJ-099, domain-service, catalog-owned);
 *   - `Medicine` / `MedicineRecord` / enums (domain).
 *
 * НЕТ зависимостей от infrastructure (кроме типа `PharmacyOfferPublic`,
 * импортированного как публичный контракт из `@dorutj/contracts`,
 * не из чужого модуля), presentation, других bounded contexts.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-031..043, SRS-CAT-061)
 * @see docs/spec/10-domain-model.md (SRS-DOM-078/079/158/159)
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.2 (долг 3.5)
 */
import { Inject, Injectable } from '@nestjs/common'
import { Barcode, DosageForm } from '@dorutj/domain-kernel'
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports/catalog-repository.port.js'
import {
  ANALOG_CANDIDATES_REPOSITORY,
  type AnalogCandidatesRepository,
} from '../ports/analog-candidates.port.js'
import {
  ANALOG_OFFER_LOOKUP_PORT,
  type AnalogOfferLookupPort,
} from '../ports/analog-offer-lookup.port.js'
import { AnalogEquivalenceService } from '../../domain/services/analog-equivalence.service.js'
import {
  CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE,
  type ControlCategory,
} from '../../domain/medicine.enums.js'
import { Medicine } from '../../domain/medicine.entity.js'
import { MedicineNotFoundError } from '../../domain/errors/medicine-not-found.error.js'
import type { MedicineRecord } from '../../domain/medicine.types.js'
import type { PharmacyOfferPublic } from '@dorutj/contracts'

/**
 * Бюджет числа кандидатов, передаваемых в доменный фильтр (SRS-CAT-061
 * «O(50), не O(N)»). Именованная константа, C6. Объявляется В USE CASE
 * (не в порту — порт принимает `limit` параметром), как и зафиксировано
 * в DTJ-100 (раздел «Что сделать», п.3).
 */
export const ANALOG_CANDIDATES_LIMIT = 50

/**
 * Дефолтный радиус поиска офферов (SRS-CAT-011). Наследуем константу из
 * `@dorutj/contracts`, не дублируем (C15).
 */
const DEFAULT_RADIUS_METERS = 5000

/** Параметры `execute`. `limit` — обрезает ПОСЛЕ сортировки, шаг 8 тикета. */
export interface FindAnalogsInput {
  readonly medicineId: string
  readonly geo?: { readonly lat: number; readonly lon: number }
  readonly radiusMeters?: number
  readonly limit?: number
}

/** Один аналог в выходном списке. Включает самый дешёвый оффер для прозрачности. */
export interface FindAnalogsItem {
  readonly medicineId: string
  readonly tradeName: string
  readonly cheapestOffer: PharmacyOfferPublic
  readonly displayPrice: number
}

/** Корневой DTO use case. `savings: null` если референс не дешевле аналога. */
export interface FindAnalogsResult {
  readonly referenceMedicineId: string
  readonly items: readonly FindAnalogsItem[]
  /** Целые дирамы (1 TJS = 100 дирам), без округления (SRS-DOM-159). `null` если экономии нет. */
  readonly savingsDiram: number | null
}

/**
 * ИСПОЛНИТЕЛЬ.
 *
 * Сигнатура — `execute(input)`, не `execute(command)`, потому что вход
 * короткий, иммутабельный и без доменных инвариантов (валидация — на
 * presentation-слое, Zod). Этот use case — orchestrator, не command-handler.
 */
@Injectable()
export class FindAnalogsUseCase {
  private readonly analogEquivalenceService: AnalogEquivalenceService

  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
    @Inject(ANALOG_CANDIDATES_REPOSITORY)
    private readonly analogCandidatesRepository: AnalogCandidatesRepository,
    @Inject(ANALOG_OFFER_LOOKUP_PORT)
    private readonly analogOfferLookup: AnalogOfferLookupPort,
  ) {
    this.analogEquivalenceService = new AnalogEquivalenceService()
  }

  /**
   * Основной метод. Возвращает `FindAnalogsResult`.
   *
   * Бросает `MedicineNotFoundError` если референс:
   *   - не существует;
   *   - `isPublished = false`;
   *   - `controlCategory ∈ {psychotropic, narcotic}`.
   *
   * НЕ бросает если SQL-кандидаты есть, но domain отфильтровал всех —
   * пустой список аналогов валиден (TC-CAT-014 и критерий приёмки «SQL
   * отсеял, domain не видит кандидата»).
   */
  public async execute(input: FindAnalogsInput): Promise<FindAnalogsResult> {
    const referenceRecord = await this.resolveReferenceOrThrow(input.medicineId)
    const confirmedRecords = await this.resolveConfirmedCandidates(referenceRecord, input.medicineId)
    const offerMap = await this.fetchOffers(input, confirmedRecords)
    const items = this.buildSortedItems(confirmedRecords, offerMap)
    const savingsDiram = computeSavingsDiram(offerMap, input.medicineId, items)
    const limitedItems = applyLimit(items, input.limit)

    return {
      referenceMedicineId: input.medicineId,
      items: limitedItems,
      savingsDiram,
    }
  }

  /** Шаги 1: резолв референса с проверкой видимости. Бросает `MedicineNotFoundError`. */
  private async resolveReferenceOrThrow(medicineId: string): Promise<MedicineRecord> {
    const record = await this.catalogRepository.findMedicineById(medicineId)
    if (record === null) {
      throw new MedicineNotFoundError(`medicine ${medicineId} not found`)
    }
    if (!isPubliclyVisible(record)) {
      // Не подтверждаем существование запрещённого/чернового id постороннему
      // (SRS-CAT-006, единая семантика с DTJ-095).
      throw new MedicineNotFoundError(`medicine ${medicineId} not found`)
    }
    return record
  }

  /** Шаги 2-4: SQL-предфильтр → полные агрегаты → авторитетный доменный фильтр. */
  private async resolveConfirmedCandidates(
    referenceRecord: MedicineRecord,
    referenceMedicineId: string,
  ): Promise<readonly MedicineRecord[]> {
    const candidateIds = await this.analogCandidatesRepository.findCandidates(
      referenceMedicineId,
      ANALOG_CANDIDATES_LIMIT,
    )
    if (candidateIds.length === 0) {
      return []
    }
    const candidateRecords = await this.catalogRepository.findMedicinesByIds(candidateIds)
    const referenceMedicine = recordToMedicine(referenceRecord)
    return candidateRecords.filter((candidateRecord) => {
      // Defense-in-depth: SQL-предфильтр уже проверяет `isPublished`, но
      // между шагом 2 и шагом 4 параллельная запись могла снять публикацию.
      if (!isPubliclyVisible(candidateRecord)) {
        return false
      }
      const candidateMedicine = recordToMedicine(candidateRecord)
      return this.analogEquivalenceService.isAnalog(referenceMedicine, candidateMedicine)
    })
  }

  /** Шаг 5: запрос офферов для подтверждённых аналогов + референса ОДНИМ батчем (C15). */
  private async fetchOffers(
    input: FindAnalogsInput,
    confirmedRecords: readonly MedicineRecord[],
  ): Promise<ReadonlyMap<string, readonly PharmacyOfferPublic[]>> {
    const offerMedicineIds: readonly string[] = [
      input.medicineId,
      ...confirmedRecords.map((r) => r.id),
    ]
    const radiusMeters = input.radiusMeters ?? DEFAULT_RADIUS_METERS
    // `exactOptionalPropertyTypes: true` запрещает передавать `undefined` в
    // опциональное поле — собираем объект условно (C15/производительность).
    const lookupInput: {
      medicineIds: readonly string[]
      geo?: { readonly lat: number; readonly lon: number }
      radiusMeters: number
    } = { medicineIds: offerMedicineIds, radiusMeters }
    if (input.geo !== undefined) {
      lookupInput.geo = input.geo
    }
    return this.analogOfferLookup.getOffersForMedicines(lookupInput)
  }

  /** Шаг 6: проекция + сортировка по цене (SRS-DOM-158). */
  private buildSortedItems(
    confirmedRecords: readonly MedicineRecord[],
    offerMap: ReadonlyMap<string, readonly PharmacyOfferPublic[]>,
  ): readonly FindAnalogsItem[] {
    const items: FindAnalogsItem[] = []
    for (const record of confirmedRecords) {
      const offers = offerMap.get(record.id) ?? []
      if (offers.length === 0) {
        // Нет офферов в радиусе — аналог не показываем.
        continue
      }
      const cheapestOffer = offers[0]
      if (cheapestOffer === undefined) continue
      items.push({
        medicineId: record.id,
        tradeName: record.tradeName,
        cheapestOffer,
        displayPrice: cheapestOffer.priceDiram,
      })
    }
    items.sort((a, b) => a.displayPrice - b.displayPrice)
    return items
  }
}

/**
 * Шаг 7: расчёт `savingsDiram` (целые дирамы, SRS-DOM-159, без округления).
 *
 * Референс ищем в `offerMap` (включён в батч на шаге 5). Если у референса
 * нет офферов или `savingsDiram <= 0` → `null`; список аналогов всё равно
 * возвращается непустым при `items.length > 0` (TC-CAT-014).
 */
function computeSavingsDiram(
  offerMap: ReadonlyMap<string, readonly PharmacyOfferPublic[]>,
  referenceMedicineId: string,
  items: readonly FindAnalogsItem[],
): number | null {
  const referenceOffers = offerMap.get(referenceMedicineId) ?? []
  if (referenceOffers.length === 0 || items.length === 0) {
    return null
  }
  const referenceOffer = referenceOffers[0]
  if (referenceOffer === undefined) {
    return null
  }
  const cheapest = items[0]
  if (cheapest === undefined) {
    return null
  }
  const diff = referenceOffer.priceDiram - cheapest.displayPrice
  return diff > 0 ? diff : null
}

/** Шаг 8: `limit` обрезает ПОСЛЕ сортировки. Дефолт — без ограничения. */
function applyLimit(
  items: readonly FindAnalogsItem[],
  limit: number | undefined,
): readonly FindAnalogsItem[] {
  if (limit === undefined || limit < 0 || items.length <= limit) {
    return items
  }
  return items.slice(0, limit)
}

/**
 * Видимость препарата для публичного API (SRS-CAT-005/006). Видим если:
 *   - `isPublished === true`;
 *   - `controlCategory ∉ {psychotropic, narcotic}`.
 *
 * **Дубль `isPubliclyVisible` из `catalog/index.ts`** — функция приватная
 * в `CatalogFacadeImpl` и не экспортируется через `index.ts`. В этом тикете
 * дублируем ЛОГИКУ, потому что:
 *   - правка `catalog/index.ts` (вынести `isPubliclyVisible` наружу) — за
 *     пределами `files_owned` тикета (§7);
 *   - вынос проверки в `domain/` без нового `DecisionService` — лишняя
 *     абстракция ради двух строк кода.
 * Зафиксировано как `foundIssues` в отчёте о сдаче: DTJ-096 должен
 * экспортировать `isPubliclyVisible` через `CatalogFacade`, и DTJ-097
 * переключит этот use case на facade-метод `isVisible(medicineId)`
 * вместо локального дублирования.
 */
function isPubliclyVisible(record: MedicineRecord): boolean {
  return (
    record.isPublished &&
    !CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(record.controlCategory)
  )
}

/**
 * Минимальный реконструктор `MedicineRecord` → `Medicine` для передачи в
 * `AnalogEquivalenceService.isAnalog(...)`.
 *
 * **Дубль `toDomain` из `infrastructure/mappers/medicine.mapper.ts`** —
 * этот маппер живёт в `infrastructure/`, и `application/` НЕ должен
 * импортировать инфраструктуру (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1).
 * Используем публичный `Medicine.restore(...)` + парсеры VO из
 * `@dorutj/domain-kernel`. Дубликат придётся поддерживать в двух местах;
 * зафиксировано как `foundIssues` — после стабилизации маппер должен
 * переехать в `domain/mappers/` (общедоступный маппер для use case'ов,
 * не инфраструктурный).
 *
 * `descriptionTj` / `descriptionRu` / `imageUrl` / `manufacturerCountry` /
 * `manufacturerName` / `requiresColdChain` / `categoryId` — не нужны
 * domain-сервису `isAnalog`, но требуются сигнатуре `Medicine.restore()`
 * (полный `MedicineCreateCommand`). Заполняем дефолтами; это безопасно,
 * потому что `AnalogEquivalenceService` НЕ читает эти поля.
 */
function recordToMedicine(record: MedicineRecord): Medicine {
  // `dosageFormClass` — строковый литерал из БД; парсим в enum.
  const dosageFormResult = DosageForm.create(record.dosageFormClass)
  if (!dosageFormResult.ok) {
    // Теоретически невозможно: `dosageFormClass` в БД прошёл CHECK-инвариант
    // и `DosageForm.create` не имеет других путей отказа. Если сюда попали —
    // значит, в БД мусор; пробрасываем как ошибку.
    throw new Error(
      `Invalid dosageFormClass in record ${record.id}: ${record.dosageFormClass} (SRS-DOM-079)`,
    )
  }
  // `controlCategory` уже приходит как enum из репозитория (см. JSDoc
  // `CatalogRepository.findMedicineById` и маппер). Trust the type.
  const controlCategory: ControlCategory = record.controlCategory

  return Medicine.restore({
    id: record.id,
    tradeName: record.tradeName,
    innName: record.innName,
    categoryId: record.categoryId,
    dosageForm: dosageFormResult.value,
    dosageStrengthRaw: record.dosageStrength,
    manufacturerCountry: record.manufacturerCountry,
    manufacturerName: record.manufacturerName,
    isPrescriptionRequired: record.isPrescriptionRequired,
    controlCategory,
    requiresColdChain: record.requiresColdChain,
    imageUrl: record.imageUrl,
    descriptionTj: record.descriptionTj,
    descriptionRu: record.descriptionRu,
    substances: record.substances.map((s) => ({
      substanceId: s.substanceId,
      strengthValue: s.strengthValue,
      strengthUnit: s.strengthUnit,
    })),
    isPublished: record.isPublished,
    barcode: record.barcode === null ? null : Barcode.parse(record.barcode),
    isGloballyIdentifiableByBarcode: record.isGloballyIdentifiableByBarcode,
  })
}