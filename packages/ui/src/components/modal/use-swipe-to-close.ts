import { useCallback, useRef, useState, type TouchEvent } from 'react'

/** Свайп вниз дальше этого порога (px) закрывает `BottomSheet` при отпускании (DTJ-406 п.2). */
export const SWIPE_CLOSE_THRESHOLD_PX = 80

export interface SwipeToCloseHandlers {
  /** Текущее смещение "ручки" вниз в px (0 — не перетаскивается/вернулась на место). */
  readonly dragOffsetPx: number
  readonly onTouchStart: (event: TouchEvent<HTMLElement>) => void
  readonly onTouchMove: (event: TouchEvent<HTMLElement>) => void
  readonly onTouchEnd: () => void
}

/**
 * Жест "потяни вниз, чтобы закрыть" для `BottomSheet` (DTJ-406 п.2) — реализован на нативных
 * `TouchEvent`, без анимационной библиотеки (`framer-motion` не установлен, решение CTO). Сложность
 * ограничена: только вертикальное смещение вниз (отрицательные значения обрезаются), закрытие
 * решается ОДНИМ порогом при отпускании (`SWIPE_CLOSE_THRESHOLD_PX`) — не требует физики/инерции.
 */
export function useSwipeToClose(onClose: () => void): SwipeToCloseHandlers {
  const [dragOffsetPx, setDragOffsetPx] = useState(0)
  const startYRef = useRef<number | null>(null)

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    startYRef.current = event.touches[0]?.clientY ?? null
  }, [])

  const onTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const startY = startYRef.current
    const currentY = event.touches[0]?.clientY
    if (startY === null || currentY === undefined) {
      return
    }
    const delta = currentY - startY
    setDragOffsetPx(delta > 0 ? delta : 0)
  }, [])

  const onTouchEnd = useCallback(() => {
    if (dragOffsetPx > SWIPE_CLOSE_THRESHOLD_PX) {
      onClose()
    }
    setDragOffsetPx(0)
    startYRef.current = null
  }, [dragOffsetPx, onClose])

  return { dragOffsetPx, onTouchStart, onTouchMove, onTouchEnd }
}
