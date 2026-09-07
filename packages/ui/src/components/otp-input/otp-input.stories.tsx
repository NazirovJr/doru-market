import type { Meta, StoryObj } from '@storybook/react-vite'
import { OtpInput } from './otp-input.js'

/** Значения `OtpLength` как свойства объекта (не элементы массива) — `no-magic-numbers`
 * освобождает числа-значения свойств объекта, присвоенного `const`, но не элементы литерала
 * массива (см. отчёт `DTJ-405`). */
const OTP_LENGTH_VALUES = { courier: 4, login: 6 }

/** `handoverOtp` (4, вручение курьеру) / login OTP (6) — `SRS-UX-021`. Известное ограничение
 * платформы: `inputmode="numeric"` на части Android-клавиатур показывает дополнительные символы
 * (запятая/точка) — не решается на уровне React-компонента (`DTJ-405` «Риски»). */
const meta: Meta<typeof OtpInput> = {
  title: 'Components/OtpInput',
  component: OtpInput,
  args: {
    label: 'Код подтверждения',
    length: 6,
    onComplete: () => undefined,
  },
  argTypes: {
    length: { control: 'select', options: Object.values(OTP_LENGTH_VALUES) },
  },
}

export default meta
type Story = StoryObj<typeof OtpInput>

export const Login: Story = { args: { length: 6 } }

export const Courier: Story = { args: { length: 4 } }

export const ErrorShake: Story = { args: { error: true } }

export const Locked: Story = { args: { locked: true } }
