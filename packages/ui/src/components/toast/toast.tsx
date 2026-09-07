import { useEffect, type ReactElement, type ReactNode } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import { ToastContext, useToastStackState, type ToastItem, type ToastVariant } from './use-toast.js'
import './toast.css'

export interface ToastProviderProps {
  readonly children: ReactNode
}

/**
 * Глобальный контейнер тостов (`SRS-UX-021`, DTJ-406 п.1). Оборачивает дерево приложения ОДИН РАЗ
 * (обычно в корне `apps/*`) — подключение самого провайдера остаётся обязанностью потребителя
 * (тикет прямо это оговаривает), пакет лишь предоставляет `ToastProvider`/`useToast()`.
 */
export const ToastProvider = ({ children }: ToastProviderProps): ReactElement => {
  const stack = useToastStackState()

  return (
    <ToastContext.Provider value={stack}>
      {children}
      <ToastViewport items={stack.items} onDismiss={stack.dismiss} />
    </ToastContext.Provider>
  )
}

interface ToastViewportProps {
  readonly items: readonly ToastItem[]
  readonly onDismiss: (id: string) => void
}

/** Стек тостов — `column-reverse` (новый снизу) через CSS, отдельные `role`/`aria-live` per-item
 * (`SRS-UX-034` «role=alert только для критичных»), несколько тостов не перекрывают друг друга
 * (`gap` в `toast.css`, DoD тест-план «очередь/стек»). */
const ToastViewport = ({ items, onDismiss }: ToastViewportProps): ReactElement => (
  <div className="ui-toast-viewport" aria-live="polite">
    {items.map((item) => (
      <ToastRow key={item.id} item={item} onDismiss={onDismiss} />
    ))}
  </div>
)

interface ToastRowProps {
  readonly item: ToastItem
  readonly onDismiss: (id: string) => void
}

function getToastRole(persistent: boolean): 'alert' | 'status' {
  return persistent ? 'alert' : 'status'
}

const ToastRow = ({ item, onDismiss }: ToastRowProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (item.persistent) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      onDismiss(item.id)
    }, item.durationMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [item.id, item.persistent, item.durationMs, onDismiss])

  return (
    <div
      role={getToastRole(item.persistent)}
      aria-live={item.persistent ? 'assertive' : 'polite'}
      className={cx(
        'ui-toast',
        `ui-toast--${item.variant}`,
        !prefersReducedMotion && 'ui-toast--motion',
      )}
    >
      <ToastIcon variant={item.variant} />
      <span className="ui-toast__message">{item.message}</span>
    </div>
  )
}

interface ToastIconProps {
  readonly variant: ToastVariant
}

/** Иконка дублирует смысл варианта не-цветом (`SRS-UX-019`) — не только цветная подложка. */
const ToastIcon = ({ variant }: ToastIconProps): ReactElement => (
  <span className="ui-toast__icon" aria-hidden="true">
    {getToastGlyph(variant)}
  </span>
)

function getToastGlyph(variant: ToastVariant): string {
  switch (variant) {
    case 'success':
      return '✓'
    case 'error':
      return '✕'
    case 'warning':
      return '!'
    case 'info':
    default:
      return 'i'
  }
}
