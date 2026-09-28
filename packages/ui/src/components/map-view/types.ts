// Отдельный файл, а не map-view.tsx — иначе use-map-markers.ts, импортируя MapPoint, замкнул бы цикл.

export interface GeoPoint {
  readonly lat: number
  readonly lng: number
}

// west/south/east/north — порядок GeoJSON bbox
export interface BBox {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
}

export interface MapPoint {
  readonly id: string
  readonly lat: number
  readonly lng: number
  readonly label?: string
  readonly meta?: unknown
}

export type MapViewMode = 'preview' | 'full'
