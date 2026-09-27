/**
 * `BottomSheet` (DTJ-406, `SRS-UX-021`/`SRS-UX-034`, критерии приёмки 2) — мобильный диалог
 * (`<768px`), выезжающий снизу. Делит `DialogShell` с `Modal` (фокус-трап/`Escape`/клик вне
 * контента — общие, см. JSDoc `dialog-shell.tsx`); отличие от `Modal` — позиционирование панели
 * и жест «свайп вниз закрывает» через отдельный grab-хэндл (не весь контент панели — иначе
 * обычный вертикальный скролл длинного контента срабатывал бы как закрытие).
 */
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
} from 'react'
import { IconButton } from '../icon-button/icon-button'
import { CloseGlyph } from '../internal/close-glyph'
import { DialogShell } from './dialog-shell'

const SWIPE_CLOSE_THRESHOLD_PX = 80
const SHEET_PADDING_PX = 24
const HANDLE_WIDTH_PX = 40
const HANDLE_HEIGHT_PX = 4
const HANDLE_TOUCH_AREA_PX = 48
const HEADER_GAP_PX = 16

export interface BottomSheetProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly title: string
  /** aria-label кнопки закрытия — уже переведённая строка (например `t('common.close')`). */
  readonly closeButtonLabel: string
  readonly children: ReactNode
}

interface SwipeHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onPointerCancel: () => void
}

const OVERLAY_STYLE: CSSProperties = {
  alignItems: 'flex-end',
  justifyContent: 'center',
}

const PANEL_STYLE: CSSProperties = {
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  borderTopLeftRadius: 'var(--radius-lg)',
  borderTopRightRadius: 'var(--radius-lg)',
  padding: `${String(SHEET_PADDING_PX)}px`,
}

const HANDLE_HIT_AREA_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  width: '100%',
  height: `${String(HANDLE_TOUCH_AREA_PX)}px`,
  marginTop: `-${String(SHEET_PADDING_PX)}px`,
  cursor: 'grab',
  touchAction: 'none',
}

/** Хук жеста свайп-вниз: отслеживает Y стартового `pointerdown` на хэндле до `pointerup`. */
const useSwipeDownToClose = (onClose: () => void): SwipeHandlers => {
  const startY = useRef<number | null>(null)

  return {
    onPointerDown: (event) => {
      startY.current = event.clientY
    },
    onPointerUp: (event) => {
      const start = startY.current
      startY.current = null
      if (start !== null && event.clientY - start > SWIPE_CLOSE_THRESHOLD_PX) {
        onClose()
      }
    },
    onPointerCancel: () => {
      startY.current = null
    },
  }
}

export const BottomSheet = ({
  isOpen,
  onClose,
  title,
  closeButtonLabel,
  children,
}: BottomSheetProps): ReactElement | null => {
  const titleId = useId()
  const swipeHandlers = useSwipeDownToClose(onClose)

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      titleId={titleId}
      panelStyle={PANEL_STYLE}
      overlayStyle={OVERLAY_STYLE}
      testId="dorutj-bottom-sheet"
    >
      <div {...swipeHandlers} style={HANDLE_HIT_AREA_STYLE} data-testid="dorutj-bottom-sheet-handle">
        <span
          aria-hidden="true"
          style={{
            width: `${String(HANDLE_WIDTH_PX)}px`,
            height: `${String(HANDLE_HEIGHT_PX)}px`,
            borderRadius: 'var(--radius-full)',
            background: 'var(--brand-border)',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: `${String(HEADER_GAP_PX)}px`,
        }}
      >
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
        <IconButton aria-label={closeButtonLabel} onClick={onClose} icon={<CloseGlyph />} />
      </div>
      <div style={{ marginTop: 'var(--space-4)' }}>{children}</div>
    </DialogShell>
  )
}
