// компоненты добавляются последующими тикетами EP-18 (заглушка манифеста волны 1, DTJ-400)
export {}

// DTJ-404: первый набор базовых примитивов (Button/IconButton/Input/Textarea/Skeleton/Badge/Chip/Card)
export { Button } from './components/button/button.js'
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button/button.js'
export { IconButton } from './components/icon-button/icon-button.js'
export type { IconButtonProps, IconButtonSize } from './components/icon-button/icon-button.js'
export { Input } from './components/input/input.js'
export type { InputProps } from './components/input/input.js'
export { Textarea } from './components/input/textarea.js'
export type { TextareaProps } from './components/input/textarea.js'
export { Skeleton } from './components/skeleton/skeleton.js'
export type { SkeletonProps, SkeletonVariant } from './components/skeleton/skeleton.js'
export { Badge } from './components/badge/badge.js'
export type { BadgeProps, BadgeTone } from './components/badge/badge.js'
export { Chip } from './components/chip/chip.js'
export type { ChipProps } from './components/chip/chip.js'
export { Card } from './components/card/card.js'
export type { CardProps } from './components/card/card.js'

// DTJ-405: формы ввода (PhoneInput/OtpInput/Select/RadioGroup/Checkbox/Switch)
export { PhoneInput } from './components/phone-input/phone-input.js'
export type { PhoneInputProps } from './components/phone-input/phone-input.js'
export { OtpInput } from './components/otp-input/otp-input.js'
export type { OtpInputProps, OtpLength } from './components/otp-input/otp-input.js'
export { Select } from './components/select/select.js'
export type { SelectProps, SelectOption } from './components/select/select.js'
export { RadioGroup } from './components/radio-group/radio-group.js'
export type { RadioGroupProps, RadioOption } from './components/radio-group/radio-group.js'
export { Checkbox } from './components/checkbox/checkbox.js'
export type { CheckboxProps } from './components/checkbox/checkbox.js'
export { Switch } from './components/switch/switch.js'
export type { SwitchProps } from './components/switch/switch.js'

// DTJ-406: обратная связь и оверлеи (Toast/Modal/BottomSheet/EmptyState/ErrorState/OfflineBanner/ProgressBar)
export { ToastProvider } from './components/toast/toast.js'
export { useToast, DEFAULT_TOAST_DURATION_MS } from './components/toast/use-toast.js'
export type {
  ToastVariant,
  ToastOptions,
  ToastItem,
  UseToastResult,
  ShowToastFn,
} from './components/toast/use-toast.js'
export { Modal } from './components/modal/modal.js'
export type { ModalProps } from './components/modal/modal.js'
export { BottomSheet } from './components/modal/bottom-sheet.js'
export type { BottomSheetProps } from './components/modal/bottom-sheet.js'
export { EmptyState } from './components/empty-state/empty-state.js'
export type { EmptyStateProps } from './components/empty-state/empty-state.js'
export { ErrorState } from './components/error-state/error-state.js'
export type { ErrorStateProps, ErrorStateVariant } from './components/error-state/error-state.js'
export { OfflineBanner } from './components/offline-banner/offline-banner.js'
export type { OfflineBannerProps } from './components/offline-banner/offline-banner.js'
export {
  useConnectionStatus,
  DEFAULT_POLL_INTERVAL_MS,
} from './components/offline-banner/use-connection-status.js'
export type { UseConnectionStatusOptions } from './components/offline-banner/use-connection-status.js'
export {
  useUiCircuitBreaker,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_BLOCK_DURATION_MS,
} from './components/offline-banner/use-ui-circuit-breaker.js'
export type {
  UseUiCircuitBreakerOptions,
  UiCircuitBreakerState,
} from './components/offline-banner/use-ui-circuit-breaker.js'
export { ProgressBar } from './components/progress-bar/progress-bar.js'
export type { ProgressBarProps } from './components/progress-bar/progress-bar.js'

// DTJ-408: навигация и данные (Tabs/Stepper/CursorTable/CursorList/SearchBar/LanguageSwitcher/BrandLogo)
export { Tabs } from './components/tabs/tabs.js'
export type { TabsProps, TabItem } from './components/tabs/tabs.js'
export { Stepper } from './components/stepper/stepper.js'
export type { StepperProps, StepItem, StepStatus } from './components/stepper/stepper.js'
export { useCursorPagination } from './components/cursor-list/use-cursor-pagination.js'
export type {
  UseCursorPaginationParams,
  UseCursorPaginationResult,
} from './components/cursor-list/use-cursor-pagination.js'
export { CursorList } from './components/cursor-list/cursor-list.js'
export type { CursorListProps } from './components/cursor-list/cursor-list.js'
export { CursorTable } from './components/cursor-list/cursor-table.js'
export type { CursorTableProps, CursorTableColumn } from './components/cursor-list/cursor-table.js'
export { SearchBar } from './components/search-bar/search-bar.js'
export type { SearchBarProps } from './components/search-bar/search-bar.js'
export { LanguageSwitcher } from './components/language-switcher/language-switcher.js'
export type { LanguageSwitcherProps } from './components/language-switcher/language-switcher.js'
export { BrandLogo } from './components/brand-logo/brand-logo.js'
export type { BrandLogoProps } from './components/brand-logo/brand-logo.js'

// DTJ-407: доменные витринные компоненты (PriceTag/SavingsBadge/AnalogBanner/MedicineCard/PharmacyOfferRow/CountdownTimer/OrderTimeline)
export { PriceTag } from './components/price-tag/price-tag.js'
export type { PriceTagProps } from './components/price-tag/price-tag.js'
export { SavingsBadge } from './components/savings-badge/savings-badge.js'
export type { SavingsBadgeProps } from './components/savings-badge/savings-badge.js'
export { AnalogBanner } from './components/analog-banner/analog-banner.js'
export type { AnalogBannerProps } from './components/analog-banner/analog-banner.js'
export { MedicineCard } from './components/medicine-card/medicine-card.js'
export type {
  MedicineCardProps,
  MedicineControlCategory,
} from './components/medicine-card/medicine-card.js'
export { PharmacyOfferRow } from './components/pharmacy-offer-row/pharmacy-offer-row.js'
export type { PharmacyOfferRowProps } from './components/pharmacy-offer-row/pharmacy-offer-row.js'
export { CountdownTimer } from './components/countdown-timer/countdown-timer.js'
export type {
  CountdownTimerProps,
  CountdownTimerPhase,
} from './components/countdown-timer/countdown-timer.js'
export { OrderTimeline } from './components/order-timeline/order-timeline.js'
export type { OrderTimelineProps, OrderTimelineStep } from './components/order-timeline/order-timeline.js'

// DTJ-409: карта аптек (MapView + use-map-markers)
export { MapView } from './components/map-view/map-view.js'
export type {
  MapViewProps,
  MapViewMode,
  MapPoint,
  GeoPoint,
  BBox,
} from './components/map-view/map-view.js'

// DTJ-410: загрузка файла + двойной канал критичных событий (FileDropzone/AudioAlertPlayer)
export { FileDropzone } from './components/file-dropzone/file-dropzone.js'
export type {
  FileDropzoneProps,
  FileDropzoneRejectionReason,
  FileQualityCheck,
} from './components/file-dropzone/file-dropzone.js'
export {
  AudioAlertPlayer,
  useAudioAlertPlayer,
} from './components/audio-alert-player/audio-alert-player.js'
export type {
  AudioAlertPlayerProps,
  AudioAlertTrigger,
  UseAudioAlertPlayerOptions,
  UseAudioAlertPlayerResult,
} from './components/audio-alert-player/audio-alert-player.js'
