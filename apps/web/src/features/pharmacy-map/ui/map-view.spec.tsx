import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import type * as DorutjUi from '@dorutj/ui'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { MapView, type MapPin } from './map-view'

/**
 * `map-view.spec.tsx` (DTJ-198/431).
 *
 * DTJ-431: `MapView` (`apps/web`) — тонкая обёртка над `MapView` (`@dorutj/ui`, DTJ-409), маппит
 * `pins`↔`points`/`bbox`↔`BBox` и держит состояние выбранного пина. Мокается САМ `@dorutj/ui`
 * (не `maplibre-gl` двумя уровнями глубже): `packages/ui` собирает `maplibre-gl` В СВОЙ
 * `dist`-чанк (не остаётся `external`, см. отчёт сдачи DTJ-431 — числа `vite build`), поэтому
 * `vi.mock('maplibre-gl', ...)` из `apps/web` не перехватывает динамический импорт ВНУТРИ уже
 * собранного `@dorutj/ui/dist` — реальный `MapLibre GL JS` в jsdom не даёт детерминированно
 * симулировать выбор точки/клик по кластеру (нет WebGL). Мок на границе пакета проверяет РОВНО
 * то, за что отвечает этот файл (тонкая обёртка): маппинг пропсов и локальное состояние выбора —
 * поведение самого общего `MapView` (кластеризация, GeoJSON-синхронизация, debounce viewport)
 * уже покрыто 370 тестами `packages/ui` (включая новые `onViewportChange`/`minZoom`, DTJ-431).
 */

interface CapturedUiMapViewProps {
  readonly points: readonly { readonly id: string; readonly lat: number; readonly lng: number; readonly label?: string }[]
  readonly center?: { readonly lat: number; readonly lng: number }
  readonly zoom?: number
  readonly minZoom?: number
  readonly mode: string
  readonly styleUrl?: string
  readonly onSelect?: (pointId: string) => void
  readonly onViewportChange?: (bbox: { lonMin: number; latMin: number; lonMax: number; latMax: number }) => void
  readonly onLoadError?: () => void
}

const { capturedProps, UiMapViewStub } = vi.hoisted(() => {
  const captured: { current: CapturedUiMapViewProps | undefined } = { current: undefined }
  const Stub = (props: CapturedUiMapViewProps): null => {
    captured.current = props
    return null
  }
  return { capturedProps: captured, UiMapViewStub: Stub }
})

vi.mock('@dorutj/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof DorutjUi>()
  return { ...actual, MapView: UiMapViewStub }
})

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const pin1: MapPin = {
  pharmacyId: '11111111-1111-1111-1111-111111111111',
  name: 'Аптека №1',
  lat: 38.55,
  lon: 68.78,
  isOpenNow: true,
  is24x7: false,
  offer: { priceDiram: 12550, stockQuantity: 7, lastSyncedAt: '2026-08-30T10:00:00Z', isStale: false },
}
const pin2: MapPin = { ...pin1, pharmacyId: '22222222-2222-2222-2222-222222222222', name: 'Аптека №2', offer: null }

function renderMap(pins: readonly MapPin[], extra: Partial<Parameters<typeof MapView>[0]> = {}): ReactElement {
  return (
    <LocaleProvider>
      <MapView center={{ lon: 68.78, lat: 38.55 }} zoom={12} pins={pins} {...extra} />
    </LocaleProvider>
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  capturedProps.current = undefined
})

describe('MapView (DTJ-198/431)', () => {
  it('1. VITE_TILESERVER_URL не задан — @dorutj/ui MapView всё равно монтируется, styleUrl передаётся как undefined (встроенный OSM-фолбэк @dorutj/ui), заглушка «карта недоступна» не рендерится', () => {
    vi.stubEnv('VITE_TILESERVER_URL', '')
    render(renderMap([]))
    expect(capturedProps.current).toBeDefined()
    expect(capturedProps.current?.styleUrl).toBeUndefined()
    expect(screen.queryByTestId('map-view-unavailable')).not.toBeInTheDocument()
  })

  it('1b. onLoadError от @dorutj/ui MapView — обёртка показывает t(\'map.unavailable\') поверх карты, сама карта остаётся смонтированной', () => {
    vi.stubEnv('VITE_TILESERVER_URL', '')
    render(renderMap([]))
    expect(screen.queryByTestId('map-view-unavailable')).not.toBeInTheDocument()

    act(() => {
      capturedProps.current?.onLoadError?.()
    })

    expect(screen.getByTestId('map-view-unavailable')).toBeInTheDocument()
    expect(capturedProps.current).toBeDefined()
  })

  it('2. styleUrl задан — маппит pins в MapPoint[] (id/lat/lng/label) и центр lon/lat → lng/lat', () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    render(renderMap([pin1, pin2]))

    expect(capturedProps.current?.styleUrl).toBe('http://localhost:8080/styles/basic/style.json')
    expect(capturedProps.current?.mode).toBe('full')
    expect(capturedProps.current?.center).toEqual({ lat: 38.55, lng: 68.78 })
    expect(capturedProps.current?.points).toEqual([
      { id: pin1.pharmacyId, lat: pin1.lat, lng: pin1.lon, label: pin1.name },
      { id: pin2.pharmacyId, lat: pin2.lat, lng: pin2.lon, label: pin2.name },
    ])
  })

  it('3. minZoom прокидывается в @dorutj/ui MapView как есть', () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    render(renderMap([], { minZoom: 9 }))
    expect(capturedProps.current?.minZoom).toBe(9)
  })

  it('4. [AC4] onSelect(pointId) — рендерит карточку аптеки (панель снизу карты) с ценой/именем, зовёт onPinClick', () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    const onPinClick = vi.fn()
    render(renderMap([pin1], { onPinClick }))

    act(() => {
      capturedProps.current?.onSelect?.(pin1.pharmacyId)
    })

    expect(onPinClick).toHaveBeenCalledWith(pin1.pharmacyId)
    expect(screen.getByTestId('pharmacy-pin-popup')).toBeInTheDocument()
    expect(screen.getByText(pin1.name)).toBeInTheDocument()
    expect(screen.getByTestId('pharmacy-pin-popup-price')).toHaveTextContent('125,50')
  })

  it('5. onSelect по пину без offer — карточка аптеки рендерится, но без блока цены', () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    render(renderMap([pin1, pin2]))

    act(() => {
      capturedProps.current?.onSelect?.(pin2.pharmacyId)
    })

    expect(screen.getByText(pin2.name)).toBeInTheDocument()
    expect(screen.queryByTestId('pharmacy-pin-popup-price')).not.toBeInTheDocument()
  })

  it('6. имя аптеки со спецсимволами не создаёт реальный <script> в DOM при выборе пина', () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    const maliciousPin: MapPin = { ...pin1, name: '<script>window.__xssFired = true</script>' }
    render(renderMap([maliciousPin]))

    act(() => {
      capturedProps.current?.onSelect?.(maliciousPin.pharmacyId)
    })

    expect(screen.getByTestId('pharmacy-pin-popup')).toBeInTheDocument()
    expect(document.querySelector('script')).not.toBeInTheDocument()
    expect((window as { __xssFired?: boolean }).__xssFired).toBeUndefined()
  })

  it('7. onViewportChange — BBox (@dorutj/ui) маппится в BboxCoordinates (@dorutj/contracts) 1:1', () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    const onViewportChange = vi.fn()
    render(renderMap([], { onViewportChange }))

    act(() => {
      capturedProps.current?.onViewportChange?.({ lonMin: 68.6, latMin: 38.4, lonMax: 68.9, latMax: 38.6 })
    })

    expect(onViewportChange).toHaveBeenCalledWith({ lonMin: 68.6, latMin: 38.4, lonMax: 68.9, latMax: 38.6 })
  })

  it('8. выбор пина, затем другого — карточка переключается на новый пин', () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    render(renderMap([pin1, pin2]))

    act(() => {
      capturedProps.current?.onSelect?.(pin1.pharmacyId)
    })
    expect(screen.getByText(pin1.name)).toBeInTheDocument()

    act(() => {
      capturedProps.current?.onSelect?.(pin2.pharmacyId)
    })
    expect(screen.queryByText(pin1.name)).not.toBeInTheDocument()
    expect(screen.getByText(pin2.name)).toBeInTheDocument()
  })
})
