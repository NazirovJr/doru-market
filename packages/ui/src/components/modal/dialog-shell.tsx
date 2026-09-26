/**
 * `DialogShell` (DTJ-406, `SRS-UX-021`/`SRS-UX-034`) — общая логика оверлея/диалога, на которой
 * построены `Modal` (десктоп, по центру) и `BottomSheet` (мобильный `<768px`, снизу): «один
 * логический компонент с адаптивным рендером по viewport» из тикета реализован ЗДЕСЬ (общий
 * фокус-трап/`Escape`/клик вне контента), а `Modal`/`BottomSheet` — два тонких визуальных
 * варианта поверх этой общей оболочки (позиционирование панели различается, поведение — нет).
 *
 * Не экспортируется из барабанных файлов пакета — деталь реализации `modal/`, как
 * `internal/spinner.tsx` для `Button`.
 *
 * `useFocusTrap` (DTJ-403) подключается ВНУТРИ — потребитель не может забыть его подключить
 * (риск, явно названный тикетом DTJ-406 п.2). Тот же хук обрабатывает `Escape` → `onClose`.
 * Клик по оверлею (не по панели) также вызывает `onClose` — `onMouseDown` на оверлее, а не
 * `onClick`, чтобы drag-выделение текста внутри панели, отпущенное за её пределами, не
 * закрывало диалог по ошибке.
 */
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useRef,
} from 'react'
import { useFocusTrap } from '@/a11y/use-focus-trap'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { buildTransition } from '../internal/motion'

const DIALOG_OVERLAY_Z_INDEX = 1000

const OVERLAY_BASE_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: DIALOG_OVERLAY_Z_INDEX,
  display: 'flex',
  background: 'color-mix(in srgb, var(--brand-text) 45%, transparent)',
}

const PANEL_BASE_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  background: 'var(--brand-surface)',
  color: 'var(--brand-text)',
  fontFamily: 'var(--brand-font-family)',
  boxShadow: 'var(--shadow-modal)',
}

export interface DialogShellProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly titleId: string
  readonly children: ReactNode
  /** Позиционирование, специфичное для `Modal`/`BottomSheet` (см. JSDoc модуля). */
  readonly panelStyle: CSSProperties
  readonly overlayStyle?: CSSProperties
  readonly testId?: string
}

const useOverlayMouseDown = (onClose: () => void): ((event: ReactMouseEvent<HTMLDivElement>) => void) =>
  (event) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

export const DialogShell = ({
  isOpen,
  onClose,
  titleId,
  children,
  panelStyle,
  overlayStyle,
  testId,
}: DialogShellProps): ReactElement | null => {
  const panelRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  useFocusTrap(panelRef, isOpen, onClose)
  const handleOverlayMouseDown = useOverlayMouseDown(onClose)

  if (!isOpen) {
    return null
  }

  return (
    <div
      data-testid={testId === undefined ? undefined : `${testId}-overlay`}
      style={{ ...OVERLAY_BASE_STYLE, ...overlayStyle }}
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        style={{
          ...PANEL_BASE_STYLE,
          transition: buildTransition(['transform', 'opacity'], prefersReducedMotion),
          ...panelStyle,
        }}
      >
        {children}
      </div>
    </div>
  )
}
