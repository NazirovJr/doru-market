import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PhoneInput } from './phone-input.js'

/** Вход в продукт (`SRS-UX-021`, `/login`) — маска `+992 XX XXX XX XX`, blur-валидация формата
 * `PhoneNumber` (`SRS-DOM-069`). Известное ограничение платформы: `inputMode="numeric"` на части
 * Android-клавиатур показывает дополнительные символы (запятая/точка) — не решается на уровне
 * React-компонента (см. `DTJ-405` «Риски»). */
const meta: Meta<typeof PhoneInput> = {
  title: 'Components/PhoneInput',
  component: PhoneInput,
  args: {
    label: 'Телефон',
  },
}

export default meta
type Story = StoryObj<typeof PhoneInput>

export const Default: Story = {
  render: (args) => {
    const Controlled = (): ReturnType<typeof PhoneInput> => {
      const [, setNormalized] = useState('')
      return <PhoneInput {...args} onChange={setNormalized} />
    }
    return <Controlled />
  },
}

export const Prefilled: Story = { args: { defaultValue: '901234567' } }

export const ErrorState: Story = {
  args: { defaultValue: '90', error: 'Введите полный номер телефона' },
}

export const Disabled: Story = { args: { disabled: true, defaultValue: '901234567' } }
