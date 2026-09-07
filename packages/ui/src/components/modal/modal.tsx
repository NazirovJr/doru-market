import { useId, useRef, type ReactElement, type ReactNode } from 'react'
import { useFocusTrap, useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import { IconButton } from '../icon-button/icon-button.js'
import { CloseIcon } from './close-icon.js'
import { createOverlayMouseDownHandler } from './close-on-overlay-click.js'
import './modal.css'

export interface ModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  /** Заголовок модалки — становится `aria-labelledby`-целью (`role="dialog"`, `SRS-UX-034`). */
  readonly title: ReactNode
  /** Доступное имя кнопки-крестика (`AGENTS.md` §9 — строка ТОЛЬКО из i18n на месте вызова, сам
   * `Modal` строк не хардкодит), например `t('common.close')`. */
  readonly closeButtonLabel: string
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly className?: string
}

/**
 * Десктопный оверлей по центру (`SRS-UX-021`). Закрытие по `Escape`/клику вне контента —
 * `useFocusTrap` из DTJ-403 подключается ВНУТРИ компонента (тикет п.2, не оставляется на
 * усмотрение потребителя). `role="dialog"` + `aria-modal="true"` + `aria-labelledby` на заголовок.
 * Кнопка закрытия — переиспользует `IconButton` (DTJ-404), не пишет свою кнопку с нуля.
 */
export const Modal = ({
  isOpen,
  onClose,
  title,
  closeButtonLabel,
  children,
  footer,
  className,
}: ModalProps): ReactElement | null => {
  const containerRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const prefersReducedMotion = useReducedMotion()

  useFocusTrap(containerRef, isOpen, onClose)

  if (!isOpen) {
    return null
  }

  return (
    <div className="ui-modal-overlay" onMouseDown={createOverlayMouseDownHandler(onClose)}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('ui-modal', !prefersReducedMotion && 'ui-modal--motion', className)}
      >
        <div className="ui-modal__header">
          <h2 id={titleId} className="ui-modal__title">
            {title}
          </h2>
          <IconButton
            icon={<CloseIcon />}
            aria-label={closeButtonLabel}
            size="sm"
            className="ui-modal__close"
            onClick={onClose}
          />
        </div>
        <div className="ui-modal__body">{children}</div>
        {footer !== undefined ? <div className="ui-modal__footer">{footer}</div> : null}
      </div>
    </div>
  )
}
