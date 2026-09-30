import { create } from 'zustand'

export type GeoStatus = 'idle' | 'pending' | 'granted' | 'denied' | 'unavailable'

export interface GeoCoords {
  readonly lat: number
  readonly lon: number
}

export interface GeoState {
  readonly status: GeoStatus
  readonly coords: GeoCoords | null
  readonly request: () => void
}

const GEO_TIMEOUT_MS = 10_000
const GEO_MAX_AGE_MS = 300_000
const COORD_PRECISION = 1000
const PERMISSION_DENIED = 1

// ~100 м: стабильные ключи запросов и не отправляем на сервер точное положение.
const roundCoord = (value: number): number => Math.round(value * COORD_PRECISION) / COORD_PRECISION

export const useGeoStore = create<GeoState>()((set) => ({
  status: 'idle',
  coords: null,
  request: (): void => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      set({ status: 'unavailable', coords: null })
      return
    }
    set({ status: 'pending' })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        set({
          status: 'granted',
          coords: { lat: roundCoord(position.coords.latitude), lon: roundCoord(position.coords.longitude) },
        })
      },
      (error) => {
        set({ status: error.code === PERMISSION_DENIED ? 'denied' : 'unavailable', coords: null })
      },
      { timeout: GEO_TIMEOUT_MS, maximumAge: GEO_MAX_AGE_MS },
    )
  },
}))
