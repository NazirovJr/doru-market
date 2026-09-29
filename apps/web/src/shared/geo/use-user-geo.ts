import { useEffect } from 'react'
import { useGeoStore, type GeoState } from './geo-store'

// Уже выданное разрешение подхватываем молча; запрос без него — только по действию пользователя.
async function isGeolocationAlreadyGranted(): Promise<boolean> {
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' })
    return permission.state === 'granted'
  } catch {
    return false
  }
}

export function useUserGeo(): GeoState {
  const geo = useGeoStore()
  const { status, request } = geo

  useEffect(() => {
    if (status !== 'idle') {
      return
    }
    void isGeolocationAlreadyGranted().then((granted) => {
      if (granted && useGeoStore.getState().status === 'idle') {
        request()
      }
    })
  }, [status, request])

  return geo
}
