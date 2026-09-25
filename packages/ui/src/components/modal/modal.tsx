/**
 * `Modal` (DTJ-406, `SRS-UX-021`/`SRS-UX-034`, критерии приёмки 2) — десктопный диалог по центру
 * экрана. Общая логика (фокус-трап, `Escape`, клик вне контента) — в `DialogShell`, см. её JSDoc
 * для того, почему `Modal`/`BottomSheet` описаны тикетом как «один логический компонент».
 *
 * Заголовок (`title`) — ОБЯЗАТЕЛЬНЫЙ проп: `aria-labelledby` указывает на его `id`
 * (критерий приёмки 2 читается вместе с `role="dialog"`/`aria-modal="true"` из `DialogShell`).
 * `title` — уже переведённая строка (как `Input.label`/`Card` — см. `input.tsx`), НЕ
 * i18n-ключ: `Modal` — универсальный контейнер произвольного контента фичи, а не owner
 * какого-то фиксированного набора экранных ключей (в отличие от `EmptyState`/`ErrorState`/
 * `OfflineBanner`, у которых набор текстов заранее известен пакету).
 */
import { type CSSProperties, type ReactElement, type ReactNode, useId } from 'react'
import { IconButton } from '../icon-button/icon-button'
import { CloseGlyph } from '../internal/close-glyph'
import { DialogShell } from './dialog-shell'

const MODAL_MAX_WIDTH_PX = 480
const MODAL_PADDING_PX = 24
const MODAL_HEADER_GAP_PX = 16

export interface ModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly title: string
  /** aria-label кнопки закрытия — уже переведённая строка (например `t('common.close')`). */
  readonly closeButtonLabel: string
  readonly children: ReactNode
}

const OVERLAY_STYLE: CSSProperties = {
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-4)',
}

const PANEL_STYLE: CSSProperties = {
  width: '100%',
  maxWidth: `${String(MODAL_MAX_WIDTH_PX)}px`,
  maxHeight: '85vh',
  overflowY: 'auto',
  borderRadius: 'var(--radius-lg)',
  padding: `${String(MODAL_PADDING_PX)}px`,
}

export const Modal = ({ isOpen, onClose, title, closeButtonLabel, children }: ModalProps): ReactElement | null => {
  const titleId = useId()
  return (
    <DialogShell isOpen={isOpen} onClose={onClose} titleId={titleId} panelStyle={PANEL_STYLE} overlayStyle={OVERLAY_STYLE} testId="dorutj-modal">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: `${String(MODAL_HEADER_GAP_PX)}px` }}>
        <h2
          id={titleId}
          style={{
            margin: 0,
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--brand-text)',
          }}
        >
          {title}
        </h2>
        <IconButton
          aria-label={closeButtonLabel}
          onClick={onClose}
          icon={<CloseGlyph />}
        />
      </div>
      <div style={{ marginTop: 'var(--space-4)' }}>{children}</div>
    </DialogShell>
  )
}
