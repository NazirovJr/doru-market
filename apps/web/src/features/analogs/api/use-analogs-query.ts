import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { httpRequestJson, type HttpError } from '@/shared/api/http-client'
import { useLocale } from '@/shared/config/locale-provider'

/**
 * `use-analogs-query.ts` (DTJ-104, `SRS-CAT-036..040`).
 *
 * TanStack Query поверх `GET /api/v1/medicines/:id/analogs` (DTJ-102, бэкенд принят CTO —
 * см. `apps/api/src/modules/catalog/presentation/{controllers/analogs.controller.ts,
 * dto/analog-result.dto.ts}`, прочитаны целиком для этого тикета). Единственная сетевая точка
 * входа фичи — компоненты `ui/` вызывают этот хук, не `fetch`/`httpRequestJson` напрямую (`02`
 * §5).
 *
 * **`AnalogsDataDto`/`AnalogItemDto`/`AnalogOfferDto` НЕ экспортированы из `@dorutj/contracts`**
 * (проверено: `packages/contracts/src/catalog.ts` содержит `PharmacyOfferPublic`, но не форму
 * ответа `/analogs`; barrel `packages/contracts/src/index.ts` явно резервирует место под будущий
 * `src/analogs.ts` эпика EP-07, которого пока нет). Типы ниже — точная копия формы,
 * сериализуемой `toAnalogsDataDto()` (`analog-result.dto.ts`), а не повторное изобретение
 * контракта — тот же приём, что `features/search/api/search.api.ts` (DTJ-192, `SuggestSuggestion`)
 * применил для `/medicines/suggest`, которого тоже нет в пакете контрактов. Зафиксировано в отчёте
 * сдачи как рекомендация завести `packages/contracts/src/analogs.ts` (правило 2 тикета DTJ-104) —
 * этот тикет её не создаёт (вне `files_owned`, правило 7 AGENTS.md).
 *
 * **`Accept-Language`.** `httpGetJson`/`httpRequestJson` (`shared/api/http-client.ts`) сегодня НЕ
 * проставляют этот заголовок ни для одного запроса приложения — локаль на бэкенде резолвится
 * ТОЛЬКО по нему (`AnalogsController.resolveLocale`, дефолт `'tj'` при отсутствии заголовка), а
 * `disclaimer`/`titleKey`-текст обязаны совпадать с текущим языком интерфейса (SRS-CAT-039).
 * Правка `shared/api/http-client.ts`, чтобы отправлять заголовок ГЛОБАЛЬНО для всех запросов
 * приложения, — вне `files_owned` этого тикета и вне охвата одного фича-модуля; вместо этого
 * `httpRequestJson` (а не `httpGetJson`, у которого нет параметра `headers`) вызывается здесь
 * напрямую с явным `Accept-Language: <locale>` — просто значение `Locale` (`'tj'|'ru'|'en'`),
 * `AnalogsController.resolveLocale` разбирает `Accept-Language` через `split(',')[0].split(';')
 * [0].split('-')[0]`, так что голое `'ru'`/`'tj'`/`'en'` резолвится корректно без BCP-47-обёртки.
 */

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
  /** Резолвленный текст (не ключ) — сервер уже подставил локализованную строку (SRS-CAT-039). */
  readonly disclaimer: string
}

export interface UseAnalogsQueryGeo {
  readonly lat: number
  readonly lon: number
}

export interface UseAnalogsQueryInput {
  readonly medicineId: string
  readonly geo?: UseAnalogsQueryGeo | undefined
  readonly radiusMeters?: number | undefined
}

function buildAnalogsPath(medicineId: string): string {
  return `/api/v1/medicines/${medicineId}/analogs`
}

/** `httpRequestJson` (не `httpGetJson`) не строит query-строку сам — собираем её здесь, см. JSDoc файла. */
function buildAnalogsQueryString(input: UseAnalogsQueryInput): string {
  const params = new URLSearchParams()
  if (input.geo !== undefined) {
    params.set('lat', String(input.geo.lat))
    params.set('lon', String(input.geo.lon))
  }
  if (input.radiusMeters !== undefined) {
    params.set('radiusMeters', String(input.radiusMeters))
  }
  const serialized = params.toString()
  return serialized.length > 0 ? `?${serialized}` : ''
}

/**
 * `retry: 0` — тот же приём, что `use-search-results.ts`/`use-pharmacy-map-pins.ts`: аналоги —
 * дополнительная, не критичная для покупки информация (DTJ-104 п.6), при сетевой ошибке блок
 * скрывается целиком СРАЗУ (`ui/analogs-block.tsx`), автоматический повтор только отложил бы это.
 */
export function useAnalogsQuery(input: UseAnalogsQueryInput): UseQueryResult<AnalogsDataDto, HttpError> {
  const { medicineId, geo, radiusMeters } = input
  const { locale } = useLocale()

  return useQuery<AnalogsDataDto, HttpError>({
    queryKey: ['analogs', medicineId, geo?.lat ?? null, geo?.lon ?? null, radiusMeters ?? null, locale],
    queryFn: () =>
      httpRequestJson<AnalogsDataDto>(`${buildAnalogsPath(medicineId)}${buildAnalogsQueryString(input)}`, {
        headers: { 'Accept-Language': locale },
      }),
    enabled: medicineId.trim().length > 0,
    retry: 0,
  })
}
