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
