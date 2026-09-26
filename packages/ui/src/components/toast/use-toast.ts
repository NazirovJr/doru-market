/**
 * `useToast` (DTJ-406, `SRS-UX-021`) — императивный API для показа тостов из любого места
 * приложения (`toast.success('...')`), без проп-дрилинга. Контекст/тип объявлены здесь (`.ts`,
 * без JSX), визуальный `ToastProvider` — в `toast.tsx` (реализует контракт этого файла).
 *
 * Автозакрытие — РОВНО 4000мс (`SRS-UX-021`, канонично побеждает 1.8с из дизайн-канваса, см.
 * JSDoc тикета DTJ-406 п.1). `persistent: true` отключает автозакрытие полностью — тост остаётся
 * до явного действия/закрытия (критерий приёмки 3).
 */
import { createContext, useContext } from 'react'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  readonly variant?: ToastVariant
  /** `true` — без автозакрытия, остаётся до явного действия/закрытия (критерий приёмки 3). */
  readonly persistent?: boolean
  /** По умолчанию `DEFAULT_TOAST_DURATION_MS` (4000мс, `SRS-UX-021`). Игнорируется, если `persistent`. */
  readonly durationMs?: number
}

export interface ToastItem {
  readonly id: string
  readonly message: string
  readonly variant: ToastVariant
  readonly persistent: boolean
  readonly durationMs: number
}

export interface ToastApi {
  readonly show: (message: string, options?: ToastOptions) => string
  readonly success: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  readonly error: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  readonly warning: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  readonly info: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  readonly dismiss: (id: string) => void
}

export interface ToastContextValue {
  readonly toasts: readonly ToastItem[]
  readonly api: ToastApi
}

/** `SRS-UX-021` — таблица компонентов, значение письменной спецификации (не 1.8с design-канваса). */
export const DEFAULT_TOAST_DURATION_MS = 4000

export const ToastContext = createContext<ToastContextValue | null>(null)

const MISSING_PROVIDER_MESSAGE =
  'useToast() вызван вне <ToastProvider> — подключите провайдер в app-слое потребителя (DTJ-406 «Что сделать» п.1).'

/** Обязателен `<ToastProvider>`-предок (см. `toast.tsx`) — иначе бросает описательную ошибку. */
export const useToast = (): ToastApi => {
  const context = useContext(ToastContext)
  if (context === null) {
    throw new Error(MISSING_PROVIDER_MESSAGE)
  }
  return context.api
}
