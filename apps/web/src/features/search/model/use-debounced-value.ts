/**
 * `use-debounced-value.ts` (DTJ-192, `SRS-CAT-027`/`REQ-UX-12`).
 *
 * ВРЕМЕННО: `packages/ui` ещё не публикует `useDebouncedValue` (см. риски тикета DTJ-192 —
 * `packages/ui/src/index.ts` на момент этого тикета пуст). Локальная реализация здесь до
 * появления общего хука в EP-18 — перенос: TODO(DTJ-192, перенос в packages/ui/shared/hooks).
 */
import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)
    return () => {
      clearTimeout(timeoutId)
    }
  }, [value, delayMs])

  return debouncedValue
}
