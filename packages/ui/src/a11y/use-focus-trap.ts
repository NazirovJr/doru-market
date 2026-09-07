import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * `SRS-UX-034` «Клавиатурная навигация»: ловушка фокуса для `Modal`/`BottomSheet` (DTJ-406).
 * При активации фокус переходит на первый интерактивный элемент контейнера, `Tab`/`Shift+Tab`
 * циклируются ВНУТРИ контейнера, `Escape` вызывает `onClose`, при деактивации фокус возвращается
 * на элемент, который был активен ДО открытия.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean,
  onClose?: () => void,
): void {
  useEffect(() => {
    if (!isActive) {
      return undefined
    }

    const container = containerRef.current
    if (container === null) {
      return undefined
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    focusFirstElement(container)

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose?.()
        return
      }
      if (event.key === 'Tab') {
        trapTabKey(container, event)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [containerRef, isActive, onClose])
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

function focusFirstElement(container: HTMLElement): void {
  const [first] = getFocusableElements(container)
  first?.focus()
}

function trapTabKey(container: HTMLElement, event: KeyboardEvent): void {
  const focusables = getFocusableElements(container)
  if (focusables.length === 0) {
    event.preventDefault()
    return
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement

  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault()
      last?.focus()
    }
    return
  }

  if (active === last || !container.contains(active)) {
    event.preventDefault()
    first?.focus()
  }
}
