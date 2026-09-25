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

// DTJ-408 — навигация и данные (Tabs, Stepper, CursorTable/CursorList, SearchBar,
// LanguageSwitcher, BrandLogo).
export type { TabItem, TabsProps } from './tabs/tabs'
export { Tabs } from './tabs/tabs'

export type { StepperProps, StepperStep, StepStatus } from './stepper/stepper'
export { Stepper } from './stepper/stepper'

export type {
  UseCursorPaginationOptions,
  UseCursorPaginationResult,
} from './cursor-list/use-cursor-pagination'
export { useCursorPagination } from './cursor-list/use-cursor-pagination'

export type { CursorTableColumn, CursorTableProps } from './cursor-list/cursor-table'
export { CursorTable } from './cursor-list/cursor-table'

export type { CursorListProps } from './cursor-list/cursor-list'
export { CursorList } from './cursor-list/cursor-list'

export type { SearchBarProps } from './search-bar/search-bar'
export { DEFAULT_SEARCH_DEBOUNCE_MS, SearchBar } from './search-bar/search-bar'

export type { LanguageSwitcherProps } from './language-switcher/language-switcher'
export { LanguageSwitcher } from './language-switcher/language-switcher'

export type { BrandLogoProps } from './brand-logo/brand-logo'
export { BrandLogo } from './brand-logo/brand-logo'

// DTJ-405 — формы ввода (PhoneInput, OtpInput, Select, RadioGroup, Checkbox, Switch).
export type { PhoneInputProps } from './phone-input/phone-input'
export { PhoneInput } from './phone-input/phone-input'

export type { OtpInputProps, OtpLength } from './otp-input/otp-input'
export { OtpInput } from './otp-input/otp-input'

export type { SelectOption, SelectProps } from './select/select'
export { Select } from './select/select'

export type { RadioGroupProps, RadioOption } from './radio-group/radio-group'
export { RadioGroup } from './radio-group/radio-group'

export type { CheckboxProps } from './checkbox/checkbox'
export { Checkbox } from './checkbox/checkbox'

export type { SwitchProps } from './switch/switch'
export { Switch } from './switch/switch'

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

// DTJ-407 — доменные витринные компоненты (PriceTag, SavingsBadge, AnalogBanner, MedicineCard,
// PharmacyOfferRow, CountdownTimer, OrderTimeline).
export type { PriceTagProps } from './price-tag/price-tag'
export { PriceTag } from './price-tag/price-tag'

export type { SavingsBadgeProps } from './savings-badge/savings-badge'
export { SavingsBadge } from './savings-badge/savings-badge'

export type { AnalogBannerProps } from './analog-banner/analog-banner'
export { AnalogBanner } from './analog-banner/analog-banner'

export type { MedicineCardControlCategory, MedicineCardProps } from './medicine-card/medicine-card'
export { MedicineCard } from './medicine-card/medicine-card'

export type { PharmacyOfferRowProps } from './pharmacy-offer-row/pharmacy-offer-row'
export { PharmacyOfferRow } from './pharmacy-offer-row/pharmacy-offer-row'

export type { CountdownEscalationStatus, CountdownTimerProps } from './countdown-timer/countdown-timer'
export { CountdownTimer, computeRemainingSeconds, formatCountdown, resolveEscalationStatus } from './countdown-timer/countdown-timer'

export type { OrderTimelineProps, OrderTimelineStep } from './order-timeline/order-timeline'
export { OrderTimeline } from './order-timeline/order-timeline'

// DTJ-410 — FileDropzone (загрузка фото рецепта/документов онбординга) + AudioAlertPlayer
// (двойной канал звук+визуал для критичных событий терминала аптеки, SRS-UX-007).
export type { FileDropzoneProps, FileDropzoneQualityCheck, FileDropzoneState, FileValidationResult } from './file-dropzone/file-dropzone'
export { FileDropzone, validateFile } from './file-dropzone/file-dropzone'

export type { AudioAlertPlayerProps, UseAudioAlertPlayerResult } from './audio-alert-player/audio-alert-player'
export { AudioAlertPlayer, useAudioAlertPlayer } from './audio-alert-player/audio-alert-player'
