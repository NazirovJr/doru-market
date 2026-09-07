import type { Meta, StoryObj } from '@storybook/react-vite'
import { MapView, type MapPoint } from './map-view.js'

/**
 * `MapView.stories.tsx` (DTJ-409) — интеграционный/визуальный прогон в РЕАЛЬНОМ браузере
 * (Storybook, не `jsdom`): единственное место, где `maplibre-gl` реально рендерит WebGL-карту в
 * этом тикете. Ручная/E2E-проверка кластеризации на пикселях и тайлов OSM — вне охвата unit-тестов
 * `map-view.spec.tsx` (замокан `maplibre-gl`, см. JSDoc того файла), переиспользуется E2E картой
 * аптек EP-08.
 */
const meta: Meta<typeof MapView> = {
  title: 'Components/MapView',
  component: MapView,
  args: { mode: 'full' },
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof MapView>

const DUSHANBE_CENTER = { lat: 38.5598, lng: 68.787 }

const SINGLE_PHARMACY: readonly MapPoint[] = [{ id: 'pharmacy-1', lat: 38.5598, lng: 68.787, label: 'Аптека «Салют»' }]

const CLUSTER_DEMO_POINT_COUNT = 24
/** Разброс координат вокруг центра (в градусах) — достаточно мал, чтобы все точки попали в один
 * кластер на среднем zoom (критерий приёмки 2). */
const CLUSTER_DEMO_SPREAD_DEGREES = 0.01
const RANDOM_CENTER_OFFSET = 0.5

/** Много близких точек на низком zoom — демонстрирует встроенную кластеризацию MapLibre GL
 * (критерий приёмки 2), реальный пиксельный рендер кластера проверяется здесь визуально. */
const MANY_CLOSE_PHARMACIES: readonly MapPoint[] = Array.from({ length: CLUSTER_DEMO_POINT_COUNT }, (_, index) => ({
  id: `pharmacy-${String(index)}`,
  lat: DUSHANBE_CENTER.lat + (Math.random() - RANDOM_CENTER_OFFSET) * CLUSTER_DEMO_SPREAD_DEGREES,
  lng: DUSHANBE_CENTER.lng + (Math.random() - RANDOM_CENTER_OFFSET) * CLUSTER_DEMO_SPREAD_DEGREES,
  label: `Аптека №${String(index + 1)}`,
}))

export const Full: Story = {
  args: { points: SINGLE_PHARMACY, center: DUSHANBE_CENTER, zoom: 13 },
}

export const Preview: Story = {
  args: { mode: 'preview', points: SINGLE_PHARMACY, center: DUSHANBE_CENTER, zoom: 13 },
}

export const Clustering: Story = {
  args: { points: MANY_CLOSE_PHARMACIES, center: DUSHANBE_CENTER, zoom: 12 },
}

/** Критерий приёмки 1 — `points=[]` + `emptyStateSlot`, `MapView` не монтирует карту вовсе. */
export const Empty: Story = {
  args: {
    points: [],
    emptyStateSlot: <p style={{ padding: 16, textAlign: 'center' }}>Аптек в этой области не найдено</p>,
  },
}
