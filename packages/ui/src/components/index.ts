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
