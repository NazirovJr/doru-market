/**
 * Типы `MapView`, вынесенные из `map-view.tsx` отдельным модулем (DTJ-431 → правка гейта).
 *
 * Причина — не стиль, а цикл в графе зависимостей: `use-map-markers.ts` и
 * `use-map-viewport-change.ts` берут отсюда `MapPoint`/`BBox`, а `map-view.tsx` импортирует сами
 * хуки. Пока типы жили в `map-view.tsx`, получалось `map-view → хук → map-view`, и `arch:check`
 * (`no-circular`) валил монорепный `pnpm verify`, хотя `tsc` и тесты пакета были зелёными:
 * цикл был чисто типовым и на рантайм не влиял. Тот же приём уже применён в `file-dropzone`
 * (`file-dropzone-types.ts`, DTJ-410).
 */

export interface GeoPoint {
  readonly lat: number
  readonly lng: number
}

/** Совпадает по форме с `BboxCoordinates` (`@dorutj/contracts`, DTJ-194) — НЕ импортирован напрямую
 * оттуда: `packages/ui` не тянет доменные/catalog-специфичные контракты (компонент домен-агностичен
 * по заданию тикета). См. «Расхождения» в отчёте сдачи — потребитель (`apps/web`) мапит свой
 * `BboxCoordinates` в этот тип на границе фичи. */
export interface BBox {
  readonly lonMin: number
  readonly latMin: number
  readonly lonMax: number
  readonly latMax: number
}

export interface MapPoint {
  readonly id: string
  readonly lat: number
  readonly lng: number
  readonly label?: string
  /** Произвольные доменные данные точки (цена/остаток/режим работы аптеки и т.п.) — `MapView` их
   * не читает и не рендерит, они долетают до потребителя через исходный массив `points`, а не
   * через `onSelect` (колбэк передаёт только `pointId`, потребитель сам находит точку по id). */
  readonly meta?: Record<string, unknown>
}

export type MapViewMode = 'preview' | 'full'
