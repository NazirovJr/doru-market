import { useId, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { useFocusTrap, useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import { IconButton } from '../icon-button/icon-button.js'
import { CloseIcon } from './close-icon.js'
import { createOverlayMouseDownHandler } from './close-on-overlay-click.js'
import { useSwipeToClose } from './use-swipe-to-close.js'
import './bottom-sheet.css'

export interface BottomSheetProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly title: ReactNode
  /** Доступное имя кнопки-крестика — строка ТОЛЬКО из i18n на месте вызова (см. `Modal`). */
  readonly closeButtonLabel: string
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly className?: string
}

function getSheetStyle(dragOffsetPx: number): CSSProperties {
  return dragOffsetPx > 0 ? { transform: `translateY(${String(dragOffsetPx)}px)`, transition: 'none' } : {}
}

/**
 * Мобильный оверлей снизу (`viewport < 768px`, `SRS-UX-021`) — тот же контракт пропсов, что и
 * `Modal` (адаптивный выбор формы делает потребитель по `viewport`, DTJ-406). Дополнительно к
 * `Escape`/клику вне контента (общие с `Modal`, `useFocusTrap` DTJ-403) поддерживает свайп вниз по
 * "ручке" — `useSwipeToClose`.
 */
export const BottomSheet = ({
  isOpen,
  onClose,
  title,
  closeButtonLabel,
  children,
  footer,
  className,
}: BottomSheetProps): ReactElement | null => {
  const containerRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const prefersReducedMotion = useReducedMotion()
  const swipe = useSwipeToClose(onClose)

  useFocusTrap(containerRef, isOpen, onClose)

  if (!isOpen) {
    return null
  }

  return (
    <div className="ui-bottom-sheet-overlay" onMouseDown={createOverlayMouseDownHandler(onClose)}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('ui-bottom-sheet', !prefersReducedMotion && 'ui-bottom-sheet--motion', className)}
        style={getSheetStyle(swipe.dragOffsetPx)}
      >
        <div
          className="ui-bottom-sheet__handle-area"
          onTouchStart={swipe.onTouchStart}
          onTouchMove={swipe.onTouchMove}
          onTouchEnd={swipe.onTouchEnd}
        >
          <span className="ui-bottom-sheet__handle" aria-hidden="true" />
        </div>
        <div className="ui-bottom-sheet__header">
          <h2 id={titleId} className="ui-bottom-sheet__title">
            {title}
          </h2>
          <IconButton
            icon={<CloseIcon />}
            aria-label={closeButtonLabel}
            size="sm"
            className="ui-bottom-sheet__close"
            onClick={onClose}
          />
        </div>
        <div className="ui-bottom-sheet__body">{children}</div>
        {footer !== undefined ? <div className="ui-bottom-sheet__footer">{footer}</div> : null}
      </div>
    </div>
  )
}
