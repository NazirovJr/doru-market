/**
 * `useFocusTrap` (DTJ-403, SRS-UX-034 «Клавиатурная навигация») — ловушка фокуса для
 * `Modal`/`BottomSheet` (DTJ-406).
 *
 * Пока `isActive === true`:
 * - при активации фокус переходит на первый интерактивный элемент контейнера (если таких нет —
 *   на сам контейнер; чтобы это сработало, контейнеру нужен `tabIndex={-1}`);
 * - `Tab`/`Shift+Tab` циклируются ВНУТРИ контейнера; если фокус каким-то образом оказался снаружи,
 *   следующий `Tab` возвращает его внутрь;
 * - `Escape` вызывает `onClose`.
 *
 * При деактивации (или размонтировании) фокус возвращается на элемент, который был активен
 * ДО открытия, — если он всё ещё в документе.
 *
 * Ограничение: видимость элемента (`display: none`, `visibility: hidden`) не проверяется —
 * под `jsdom` раскладки нет, и такая проверка давала бы разное поведение в тестах и в браузере.
 * Скрытые элементы исключаются из tab-порядка через `disabled`, `inert`, `aria-hidden="true"`
 * или `tabIndex={-1}`.
 */
import { type RefObject, useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

const isTabbable = (element: HTMLElement): boolean =>
  element.tabIndex >= 0 &&
  element.closest('[inert]') === null &&
  element.closest('[aria-hidden="true"]') === null

/** Интерактивные элементы контейнера в tab-порядке документа. */
export const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isTabbable)

const focusInitial = (container: HTMLElement): void => {
  const [first] = getFocusableElements(container)
  ;(first ?? container).focus()
}

const cycleFocus = (container: HTMLElement, event: KeyboardEvent): void => {
  const focusable = getFocusableElements(container)
  const first = focusable.at(0)
  const last = focusable.at(-1)
  if (first === undefined || last === undefined) {
    event.preventDefault()
    container.focus()
    return
  }
  const active = document.activeElement
  const isOutside = active === null || !container.contains(active)
  if (event.shiftKey && (isOutside || active === first)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (isOutside || active === last)) {
    event.preventDefault()
    first.focus()
  }
}

const restoreFocus = (element: HTMLElement | null): void => {
  if (element?.isConnected === true) {
    element.focus()
  }
}

export const useFocusTrap = (
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean,
  onClose?: () => void,
): void => {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const container = containerRef.current
    if (!isActive || container === null) {
      return undefined
    }
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    focusInitial(container)

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current?.()
      } else if (event.key === 'Tab') {
        cycleFocus(container, event)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      restoreFocus(previouslyFocused)
    }
  }, [containerRef, isActive])
}
