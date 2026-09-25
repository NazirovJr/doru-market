/**
 * `useReducedMotion` (DTJ-403, SRS-UX-020, SRS-UX-034 «Анимация/движение»).
 *
 * Возвращает `true`, когда пользователь включил системную настройку «уменьшить движение»
 * (`prefers-reduced-motion: reduce`). Подписан на событие `change` у `MediaQueryList`, поэтому
 * переключение настройки в рантайме перерисовывает компонент БЕЗ перезагрузки страницы и
 * без перемонтирования.
 *
 * Правило использования для анимированных компонентов (SRS-UX-020):
 * - декоративные переходы при `true` отключаются полностью;
 * - функциональные переходы (`default → loading → success/error`) сокращаются до мгновенной смены.
 *
 * Среда без `window.matchMedia` (SSR, старый WebView) трактуется как «предпочтение не задано» —
 * `false`: это стандартное поведение медиа-запроса, у которого нет совпадения.
 */
import { useSyncExternalStore } from 'react'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const getMediaQueryList = (): MediaQueryList | null => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }
  return window.matchMedia(REDUCED_MOTION_QUERY)
}

const subscribe = (onStoreChange: () => void): (() => void) => {
  const mediaQueryList = getMediaQueryList()
  if (mediaQueryList === null) {
    return () => undefined
  }
  mediaQueryList.addEventListener('change', onStoreChange)
  return () => {
    mediaQueryList.removeEventListener('change', onStoreChange)
  }
}

const getSnapshot = (): boolean => getMediaQueryList()?.matches ?? false

const getServerSnapshot = (): boolean => false

export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
