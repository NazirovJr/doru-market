import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { BboxCoordinates, PharmacyMapResponseDto } from '@dorutj/contracts'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'

/**
 * `use-pharmacy-map-pins.ts` (DTJ-199, SRS-CAT-052/053/054).
 *
 * TanStack Query поверх `GET /api/v1/pharmacies/map?bbox=...&medicineId=...` (DTJ-197, тот же
 * `httpGetJson` слой `shared/api/http-client`, что и у остальных фич — `apps/pages` не имеют
 * права ходить в сеть напрямую, docs/02-CLEAN-ARCHITECTURE-AND-CODE.md §5).
 *
 * `queryKey` меняется при каждом новом `bbox` (панорамирование/зум карты, `use-map-viewport.ts`
 * внутри `MapView` уже схлопывает серию событий одного жеста в один вызов `onViewportChange`
 * — здесь достаточно довериться готовому debounce, повторно его не реализуем).
 *
 * `placeholderData: keepPreviousData` — при смене `bbox` карта НЕ обязана мгновенно стирать уже
 * отрисованные пины: старые остаются видны, пока грузятся новые (иначе каждое панорамирование
 * на секунду очищало бы карту, что хуже, чем показать чуть устаревшие пины).
 *
 * `retry: 0` — `400 VALIDATION_ERROR` (bbox превышает `BBOX_MAX_AREA_KM2`, SRS-CAT-054) не
 * исправится повторным запросом того же bbox; на сетевой сбой пользователь сам инициирует повтор
 * (кнопка «Повторить» на `map-page`), автоматический ретрай здесь не нужен.
 */

export interface UsePharmacyMapPinsInput {
  readonly bbox: BboxCoordinates
  readonly medicineId?: string | undefined
}

function serializeBbox(bbox: BboxCoordinates): string {
  return `${String(bbox.lonMin)},${String(bbox.latMin)},${String(bbox.lonMax)},${String(bbox.latMax)}`
}

export function usePharmacyMapPins({
  bbox,
  medicineId,
}: UsePharmacyMapPinsInput): UseQueryResult<PharmacyMapResponseDto, HttpError> {
  const bboxParam = serializeBbox(bbox)

  return useQuery<PharmacyMapResponseDto, HttpError>({
    queryKey: ['pharmacy-map', 'pins', bboxParam, medicineId ?? null],
    queryFn: () =>
      httpGetJson<PharmacyMapResponseDto>('/api/v1/pharmacies/map', {
        bbox: bboxParam,
        medicineId,
      }),
    retry: 0,
    placeholderData: keepPreviousData,
  })
}
