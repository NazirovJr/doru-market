import { useEffect, useState } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * `SRS-UX-020`: переход между состояниями `default → loading → success/error` (≤200мс) обязан
 * уважать системную настройку `prefers-reduced-motion` — декоративные переходы отключаются
 * полностью, функциональные сокращаются до мгновенной смены. Подписывается на изменение в
 * рантайме через `MediaQueryList.addEventListener('change', …)`, а не только читает значение при
 * монтировании — пользователь может переключить системную настройку, не перезагружая страницу.
 */
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(readPreference)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY)
    const handleChange = (event: MediaQueryListEvent): void => {
      setPrefersReducedMotion(event.matches)
    }

    mediaQueryList.addEventListener('change', handleChange)

    return () => {
      mediaQueryList.removeEventListener('change', handleChange)
    }
  }, [])

  return prefersReducedMotion
}

function readPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}
