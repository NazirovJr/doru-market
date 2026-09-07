import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * `Toast` (`SRS-UX-021`): `success`/`error`/`info`/`warning` — чисто визуальная семантика (иконка +
 * подложка), текст — ответственность вызывающего кода (в отличие от `EmptyState`/`ErrorState`/
 * `OfflineBanner`, `Toast` НЕ входит в список компонентов DoD тикета, обязанных принимать только
 * i18n-ключи — сообщение может быть построено из динамических данных на месте вызова, вызывающий
 * код обязан сам прогнать текст через `useT()` до вызова `toast.success(...)`, `AGENTS.md` §9).
 */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

/** `SRS-UX-021`: обычный тост закрывается автоматически через 4с, `persistent` — остаётся до
 * явного действия/закрытия (используется для критичных уведомлений, тест-план DTJ-406 AC3). */
export const DEFAULT_TOAST_DURATION_MS = 4000

export interface ToastOptions {
  readonly message: ReactNode
  readonly variant?: ToastVariant
  /** Критичный тост — без автозакрытия, остаётся до явного `dismiss()` (AC3). */
  readonly persistent?: boolean
  /** Переопределение таймера автозакрытия (мс); игнорируется, если `persistent`. */
  readonly durationMs?: number
}

export interface ToastItem {
  readonly id: string
  readonly message: ReactNode
  readonly variant: ToastVariant
  readonly persistent: boolean
  readonly durationMs: number
}

const DEFAULT_VARIANT: ToastVariant = 'info'

export interface ToastContextValue {
  readonly items: readonly ToastItem[]
  readonly show: (options: ToastOptions) => string
  readonly dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined)

let toastIdSequence = 0

/** Генератор id — счётчик модуля, а не `crypto.randomUUID()`/`Math.random()`: детерминированно и
 * без зависимости от рантайм-доступности Web Crypto в старых WebView (см. риски DTJ-401). */
function nextToastId(): string {
  toastIdSequence += 1
  return `toast-${String(toastIdSequence)}`
}

export type ShowToastFn = (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'variant'>) => string

export interface UseToastResult {
  /** Императивный вызов с полным контролем над `variant`/`persistent`/`durationMs`. */
  readonly show: (options: ToastOptions) => string
  readonly success: ShowToastFn
  readonly error: ShowToastFn
  readonly info: ShowToastFn
  readonly warning: ShowToastFn
  readonly dismiss: (id: string) => void
}

function useToastContextValue(): ToastContextValue {
  const context = useContext(ToastContext)
  if (context === undefined) {
    throw new Error('useToast() должен использоваться внутри <ToastProvider>')
  }
  return context
}

/**
 * `useToast()` — императивный вызов `toast.success('...')` из любого места приложения (не
 * проп-дрилинг, тикет DTJ-406 п.1). Требует `<ToastProvider>` выше по дереву (подключение —
 * обязанность `apps/*`, сам пакет только предоставляет провайдер).
 */
export function useToast(): UseToastResult {
  const { show, dismiss } = useToastContextValue()

  const makeVariantShow = useCallback(
    (variant: ToastVariant): ShowToastFn =>
      (message, options) =>
        show({ message, variant, ...options }),
    [show],
  )

  const success = useMemo(() => makeVariantShow('success'), [makeVariantShow])
  const error = useMemo(() => makeVariantShow('error'), [makeVariantShow])
  const info = useMemo(() => makeVariantShow('info'), [makeVariantShow])
  const warning = useMemo(() => makeVariantShow('warning'), [makeVariantShow])

  return { show, success, error, info, warning, dismiss }
}

/** Внутреннее состояние стека тостов — используется `ToastProvider` в `toast.tsx`. */
export function useToastStackState(): ToastContextValue {
  const [items, setItems] = useState<readonly ToastItem[]>([])

  const dismiss = useCallback((id: string): void => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const show = useCallback((options: ToastOptions): string => {
    const id = nextToastId()
    const item: ToastItem = {
      id,
      message: options.message,
      variant: options.variant ?? DEFAULT_VARIANT,
      persistent: options.persistent ?? false,
      durationMs: options.durationMs ?? DEFAULT_TOAST_DURATION_MS,
    }
    setItems((current) => [...current, item])
    return id
  }, [])

  return useMemo(() => ({ items, show, dismiss }), [items, show, dismiss])
}
