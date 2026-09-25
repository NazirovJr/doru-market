/**
 * Барабанный экспорт `packages/ui/src/components` (D-27) — публичный фасад компонентов пакета.
 * Первое наполнение — DTJ-404 (8 базовых примитивов). Последующие тикеты EP-18 (DTJ-405..411)
 * ДОБАВЛЯЮТ сюда новые строки, не переписывая существующие (D-27, `docs/03-ARCHITECT-DECISIONS.md`).
 */
export type { ButtonProps, ButtonSize, ButtonVariant } from './button/button'
export { Button } from './button/button'

export type { IconButtonProps } from './icon-button/icon-button'
export { IconButton } from './icon-button/icon-button'

export type { InputProps } from './input/input'
export { Input } from './input/input'

export type { TextareaProps } from './input/textarea'
export { Textarea } from './input/textarea'

export type { SkeletonProps, SkeletonVariant } from './skeleton/skeleton'
export { Skeleton } from './skeleton/skeleton'

export type { BadgeProps, BadgeTone } from './badge/badge'
export { Badge } from './badge/badge'

export type { ChipProps } from './chip/chip'
export { Chip } from './chip/chip'

export type { CardInteractiveProps, CardProps } from './card/card'
export { Card } from './card/card'

// DTJ-406 — обратная связь и оверлеи (Toast, Modal/BottomSheet, EmptyState, ErrorState,
// OfflineBanner, ProgressBar).
export type { ToastApi, ToastItem, ToastOptions, ToastVariant } from './toast/use-toast'
export { useToast } from './toast/use-toast'
export type { ToastProviderProps } from './toast/toast'
export { ToastProvider } from './toast/toast'

export type { ModalProps } from './modal/modal'
export { Modal } from './modal/modal'
export type { BottomSheetProps } from './modal/bottom-sheet'
export { BottomSheet } from './modal/bottom-sheet'

export type { EmptyStateProps } from './empty-state/empty-state'
export { EmptyState } from './empty-state/empty-state'

export type { ErrorStateProps, ErrorStateVariant } from './error-state/error-state'
export { ErrorState } from './error-state/error-state'

export type { OfflineBannerProps } from './offline-banner/offline-banner'
export { OfflineBanner } from './offline-banner/offline-banner'

export type { ProgressBarProps } from './progress-bar/progress-bar'
export { ProgressBar } from './progress-bar/progress-bar'
