/**
 * `analog-result.dto.ts` (DTJ-102, EP-07, R1) — JSON-контракт
 * `GET /api/v1/medicines/:id/analogs` (SRS-API-014/015).
 *
 * Маппинг `FindAnalogsResult` (DTJ-101, use case) → JSON делается ЗДЕСЬ, в
 * presentation (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §3.2: DTO↔domain маппинг —
 * в presentation, не в use case).
 *
 * **`manufacturerName`/`isPrescriptionRequired` — обогащение, не из use case.**
 * `FindAnalogsItem` (`find-analogs.use-case.ts`, DTJ-101, ВНЕ `files_owned` этого
 * тикета) не содержит этих двух полей. `AnalogsController` подгружает их батчем
 * через `CatalogRepository.findMedicinesByIds` ОТДЕЛЬНЫМ вызовом ПОСЛЕ
 * `FindAnalogsUseCase.execute()` и передаёт сюда карту `id → запись`. Не N+1
 * (один батч-запрос на весь список), но дублирует часть работы, которую use
 * case уже сделал внутри себя (`confirmedRecords`) и не вернул наружу —
 * зафиксировано в `foundIssues` отчёта сдачи как рекомендация расширить
 * `FindAnalogsItem` в DTJ-101 напрямую следующим тикетом.
 *
 * **Тип записи — выведен из `CatalogRepository`, не импортирован из `domain/`
 * напрямую.** `presentation` не имеет права импортировать `domain/*`
 * (`dependency-cruiser` правило `presentation-goes-through-application`, см.
 * тот же обход в `catalog-search.controller.ts`, JSDoc `GeoPoint`) — `MedicineRecordDto`
 * ниже выведен через `ReturnType<CatalogRepository['findMedicinesByIds']>`
 * (application-порт), а не `import type { MedicineRecord } from '.../domain/...'`.
 *
 * **Rx-бейдж — ПЕР-КАРТОЧЕЧНЫЙ (решение CTO D-EP07-3, SRS-CAT-040).**
 * `isPrescriptionRequired` берётся из записи КОНКРЕТНОГО аналога, не
 * референсного препарата и не агрегированного флага блока — аналог
 * рецептурного препарата может быть безрецептурным и наоборот, перепутать
 * здесь означает показать «без рецепта» на рецептурном препарате.
 *
 * **`disclaimer` — обязателен всегда (решение CTO D-EP07-2, SRS-CAT-039).**
 * Поле типа `string` (не `string | null`, не опциональное) — структурно
 * невозможно забыть: `toAnalogsDataDto` не может собрать `AnalogsDataDto` без
 * уже резолвленной строки (см. `AnalogsController.resolveDisclaimer` — бросает
 * `InternalServerErrorException`, если строки в БД нет, НЕ подставляет хардкод,
 * правило 9 AGENTS.md).
 *
 * **`savingsDiram: null`, не отсутствие поля.** Тикет допускает оба варианта
 * («отсутствует/null», DTJ-102 п.3) — выбран явный `null`: проще типизировать
 * при `exactOptionalPropertyTypes: true`, и клиенту не нужно различать «поле не
 * сериализовано» от «поле есть, значение null».
 */
import type { PharmacyOfferPublic } from '@dorutj/contracts'
import type { FindAnalogsResult } from '@/modules/catalog/application/use-cases/find-analogs.use-case.js'
import type { CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'

/** Выведен из порта — см. JSDoc файла. Экспортирован — переиспользуется `AnalogsController`
 *  для типизации карты обогащения `medicineRecordsById` (см. его JSDoc). */
export type MedicineRecordDto = Awaited<ReturnType<CatalogRepository['findMedicinesByIds']>>[number]

export const TITLE_KEY_SAVINGS = 'catalog.analogs.title_savings'
export const TITLE_KEY_NEUTRAL = 'catalog.analogs.title_neutral'

export interface AnalogOfferDto {
  readonly pharmacyId: string
  readonly priceDiram: number
  readonly distanceMeters: number | null
  readonly isStale: boolean
  readonly lastSyncedAt: string | null
}

export interface AnalogItemDto {
  readonly medicineId: string
  readonly tradeName: string
  readonly manufacturerName: string
  readonly cheapestOffer: AnalogOfferDto
  readonly isPrescriptionRequired: boolean
}

export interface AnalogsDataDto {
  readonly referenceMedicineId: string
  readonly items: readonly AnalogItemDto[]
  /** Целые дирамы (SRS-DOM-159). `null` — экономии нет ИЛИ она `<= 0` (SRS-CAT-037). */
  readonly savingsDiram: number | null
  readonly titleKey: string
  /** Резолвленный текст (не ключ) — SRS-CAT-039/042. Обязателен при КАЖДОМ рендере. */
  readonly disclaimer: string
}

function toAnalogOfferDto(offer: PharmacyOfferPublic): AnalogOfferDto {
  return {
    pharmacyId: offer.pharmacyId,
    priceDiram: offer.priceDiram,
    distanceMeters: offer.distanceMeters,
    isStale: offer.isStale,
    lastSyncedAt: offer.lastSyncedAt,
  }
}

/** SRS-CAT-037: `savingsDiram === null` → нейтральный заголовок, иначе — «Сэкономьте». */
function resolveTitleKey(savingsDiram: number | null): string {
  return savingsDiram === null ? TITLE_KEY_NEUTRAL : TITLE_KEY_SAVINGS
}

/**
 * Собирает один `AnalogItemDto`. `record === undefined` теоретически
 * недостижимо (`findMedicinesByIds` вызывается с теми же id, что уже вернул
 * use case), но контроллер не должен уронить весь ответ, если это всё же
 * произойдёт (например, гонка с удалением записи) — элемент пропускается.
 */
function toAnalogItemDto(
  item: FindAnalogsResult['items'][number],
  record: MedicineRecordDto | undefined,
): AnalogItemDto | null {
  if (record === undefined) return null
  return {
    medicineId: item.medicineId,
    tradeName: item.tradeName,
    manufacturerName: record.manufacturerName,
    cheapestOffer: toAnalogOfferDto(item.cheapestOffer),
    isPrescriptionRequired: record.isPrescriptionRequired,
  }
}

/**
 * Собирает JSON-DTO ответа. `medicineRecordsById` — обогащение из
 * `CatalogRepository` (см. JSDoc файла), `disclaimer` — уже резолвленный текст
 * (контроллер резолвит его через `I18nOverridesRepository` ДО вызова этой функции).
 */
export function toAnalogsDataDto(
  result: FindAnalogsResult,
  medicineRecordsById: ReadonlyMap<string, MedicineRecordDto>,
  disclaimer: string,
): AnalogsDataDto {
  const items: AnalogItemDto[] = []
  for (const item of result.items) {
    const dto = toAnalogItemDto(item, medicineRecordsById.get(item.medicineId))
    if (dto !== null) items.push(dto)
  }
  return {
    referenceMedicineId: result.referenceMedicineId,
    items,
    savingsDiram: result.savingsDiram,
    titleKey: resolveTitleKey(result.savingsDiram),
    disclaimer,
  }
}
