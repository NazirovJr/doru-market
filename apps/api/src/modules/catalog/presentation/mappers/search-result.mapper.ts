/**
 * `search-result.mapper.ts` (DTJ-190, EP-06, R1) — presentation-мапперы `SearchResultPage`/
 * `SuggestMedicinesResultItem[]` (application, DTJ-188/189) → HTTP DTO (`@dorutj/contracts`
 * `search.ts`, DTJ-180). Единственное место, где application-результат превращается в
 * публичный контракт (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1 — сущность/внутренняя форма
 * никогда не возвращается наружу как есть).
 *
 * **`SearchResultItem` (порт) → `SearchResultItemDto` (контракт).** Поля идентичны 1:1 по
 * имени и типу (оба списаны с одной и той же `SRS-CAT-011`) — маппер тем не менее пересобирает
 * объект явно (не `as`/spread «на удачу»): граница `application → presentation` остаётся
 * явной даже при полном совпадении формы, тот же приём, что `pharmacy-map.dto.ts` (DTJ-197).
 *
 * **`SuggestMedicinesResultItem` (дискриминированный союз use case'а) → плоский
 * `SuggestResponseItemDto`.** Контракт `SuggestItemSchema` (`packages/contracts/src/search.ts`)
 * описывает ТОЛЬКО подсказку, привязанную к медикаменту (`medicineId`/`innName` обязательны) —
 * он не знает про trending-ветку (`SRS-CAT-030`, пустой `q`), т.к. `SuggestItemSchema` списан
 * дословно с `SuggestItem` порта (`SRS-CAT-011`), а не с полного ответа use case'а. JSDoc
 * `SuggestMedicinesUseCase` («Форма ответа») явно передаёт решение о финальной HTTP-форме
 * этому тикету (DTJ-190): «мапинг-заглушка `medicineId: null` — задача presentation». Ниже —
 * ровно эта заглушка: `SuggestResponseItemDto` — контракт-совместимая форма
 * (`medicineId`/`innName`/`matchedVia`), расширенная nullable-полями и значением
 * `matchedVia: 'trending'` для ветки без привязки к конкретному медикаменту.
 */
import type { PharmacyOfferDto, SearchResultItemDto } from '@dorutj/contracts'
import type {
  PharmacyOffer,
  SearchResultItem,
  SearchResultPage,
} from '@/modules/catalog/application/search/ports/search-provider.port.js'
import type {
  SuggestMedicinesResultItem,
} from '@/modules/catalog/application/use-cases/suggest-medicines.use-case.js'

function toPharmacyOfferDto(offer: PharmacyOffer): PharmacyOfferDto {
  return {
    pharmacyId: offer.pharmacyId,
    pharmacyName: offer.pharmacyName,
    priceDiram: offer.priceDiram,
    stockQuantity: offer.stockQuantity,
    distanceMeters: offer.distanceMeters,
    lastSyncedAt: offer.lastSyncedAt,
    isStale: offer.isStale,
  }
}

/** `SearchResultItem` (порт) → `SearchResultItemDto` (контракт) — идентичный маппинг по полю. */
export function toSearchResultItemDto(item: SearchResultItem): SearchResultItemDto {
  return {
    medicineId: item.medicineId,
    tradeName: item.tradeName,
    innName: item.innName,
    dosageForm: item.dosageForm,
    dosageStrength: item.dosageStrength,
    imageUrl: item.imageUrl,
    isPrescriptionRequired: item.isPrescriptionRequired,
    cheapestOffer: item.cheapestOffer === null ? null : toPharmacyOfferDto(item.cheapestOffer),
    offersCountInRadius: item.offersCountInRadius,
    relevanceScore: item.relevanceScore,
  }
}

/** Массив результатов страницы поиска → массив HTTP DTO (без обёртки — обёртку строит контроллер, `ok()`). */
export function toSearchResultPageItems(page: SearchResultPage): readonly SearchResultItemDto[] {
  return page.items.map(toSearchResultItemDto)
}

/**
 * Форма одного пункта автодополнения в HTTP-ответе — контракт-совместимое расширение
 * `SuggestItemDto` (см. JSDoc файла, «мапинг-заглушка»). `medicineId`/`innName` — `null` ТОЛЬКО
 * для `kind: 'trending'` (пустой `q`, `SRS-CAT-030`); для `kind: 'medicine'` — всегда строка,
 * как в исходном `SuggestItemDto`.
 */
export interface SuggestResponseItemDto {
  readonly medicineId: string | null
  readonly tradeName: string
  readonly innName: string | null
  readonly matchedVia: 'prefix' | 'trigram' | 'inn' | 'trending'
}

export function toSuggestResponseItemDto(item: SuggestMedicinesResultItem): SuggestResponseItemDto {
  if (item.kind === 'trending') {
    return { medicineId: null, tradeName: item.tradeName, innName: null, matchedVia: 'trending' }
  }
  return {
    medicineId: item.medicineId,
    tradeName: item.tradeName,
    innName: item.innName,
    matchedVia: item.matchedVia,
  }
}

export function toSuggestResponseDto(
  items: readonly SuggestMedicinesResultItem[],
): readonly SuggestResponseItemDto[] {
  return items.map(toSuggestResponseItemDto)
}
