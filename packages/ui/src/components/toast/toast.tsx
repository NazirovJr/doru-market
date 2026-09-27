/**
 * `ToastProvider` (DTJ-406, `SRS-UX-021`) — глобальный контейнер тостов. Пакет предоставляет
 * провайдер и рендер очереди; ПОДКЛЮЧЕНИЕ в дерево приложения (`app`-слой) — обязанность
 * потребителя (`apps/*`), см. JSDoc тикета. Несколько тостов подряд складываются в СТЕК
 * (`flex-direction: column`, `gap`) — не перекрывают друг друга (тест-план DTJ-406).
 */
import { type ReactElement, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { IconButton } from '../icon-button/icon-button'
import { CloseGlyph } from '../internal/close-glyph'
import { buildTransition } from '../internal/motion'
import {
  DEFAULT_TOAST_DURATION_MS,
  ToastContext,
  type ToastApi,
  type ToastContextValue,
  type ToastItem,
  type ToastOptions,
  type ToastVariant,
} from './use-toast'

export interface ToastProviderProps {
  readonly children: ReactNode
  /** aria-label кнопки закрытия тоста — уже переведённая строка (например `t('common.close')`). */
  readonly closeButtonLabel: string
}

interface VariantPalette {
  readonly background: string
  readonly border: string
  readonly color: string
}

const VARIANT_PALETTE: Readonly<Record<ToastVariant, VariantPalette>> = {
  success: { background: 'var(--brand-success-bg)', border: 'var(--brand-success-border)', color: 'var(--brand-success-text)' },
  error: { background: 'var(--brand-danger-bg)', border: 'var(--brand-danger-border)', color: 'var(--brand-danger-text)' },
  warning: { background: 'var(--brand-warning-bg)', border: 'var(--brand-warning-border)', color: 'var(--brand-warning-text)' },
  info: { background: 'var(--brand-surface)', border: 'var(--brand-border)', color: 'var(--brand-text)' },
}

const VIEWPORT_Z_INDEX = 1000
const VIEWPORT_BOTTOM_PX = 24
const TOAST_MAX_WIDTH_PX = 360
const CLOSE_GLYPH_SIZE_PX = 14

const useToastQueue = (): ToastContextValue => {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const idCounterRef = useRef(0)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string): void => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((previous) => previous.filter((item) => item.id !== id))
  }, [])

  const show = useCallback(
    (message: string, options?: ToastOptions): string => {
      idCounterRef.current += 1
      const id = `dorutj-toast-${String(idCounterRef.current)}`
      const persistent = options?.persistent ?? false
      const durationMs = options?.durationMs ?? DEFAULT_TOAST_DURATION_MS
      setToasts((previous) => [
        ...previous,
        { id, message, variant: options?.variant ?? 'info', persistent, durationMs },
      ])
      if (!persistent) {
        timersRef.current.set(
          id,
          setTimeout(() => {
            dismiss(id)
          }, durationMs),
        )
      }
      return id
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, options) => show(message, { ...options, variant: 'success' }),
      error: (message, options) => show(message, { ...options, variant: 'error' }),
      warning: (message, options) => show(message, { ...options, variant: 'warning' }),
      info: (message, options) => show(message, { ...options, variant: 'info' }),
      dismiss,
    }),
    [show, dismiss],
  )

  return useMemo<ToastContextValue>(() => ({ toasts, api }), [toasts, api])
}

interface ToastRowProps {
  readonly item: ToastItem
  readonly onDismiss: (id: string) => void
  readonly closeButtonLabel: string
}

const ToastRow = ({ item, onDismiss, closeButtonLabel }: ToastRowProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const palette = VARIANT_PALETTE[item.variant]
  return (
    <div
      role={item.variant === 'error' ? 'alert' : 'status'}
      aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
      data-testid="dorutj-toast"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        boxSizing: 'border-box',
        maxWidth: `${String(TOAST_MAX_WIDTH_PX)}px`,
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        boxShadow: 'var(--shadow-sm)',
        fontFamily: 'var(--brand-font-family)',
        fontSize: 'var(--font-size-sm)',
        transition: buildTransition(['opacity', 'transform'], prefersReducedMotion),
      }}
    >
      <span style={{ flex: 1 }}>{item.message}</span>
      <IconButton
        aria-label={closeButtonLabel}
        onClick={() => {
          onDismiss(item.id)
        }}
        icon={<CloseGlyph sizePx={CLOSE_GLYPH_SIZE_PX} />}
      />
    </div>
  )
}

export const ToastProvider = ({ children, closeButtonLabel }: ToastProviderProps): ReactElement => {
  const contextValue = useToastQueue()
  const { toasts, api } = contextValue

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        data-testid="dorutj-toast-viewport"
        style={{
          position: 'fixed',
          zIndex: VIEWPORT_Z_INDEX,
          bottom: `${String(VIEWPORT_BOTTOM_PX)}px`,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {toasts.map((item) => (
          <ToastRow key={item.id} item={item} onDismiss={api.dismiss} closeButtonLabel={closeButtonLabel} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
