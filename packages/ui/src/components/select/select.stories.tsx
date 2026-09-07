import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Select } from './select.js'

const OPTIONS = [
  { value: 'ru', label: 'Русский' },
  { value: 'tj', label: 'Тоҷикӣ' },
  { value: 'en', label: 'English' },
]

/** `closed`/`open`, `role="listbox"`, полная клавиатурная навигация (`SRS-UX-021`). */
const meta: Meta<typeof Select> = {
  title: 'Components/Select',
  component: Select,
  args: {
    label: 'Язык интерфейса',
    options: OPTIONS,
    value: null,
    placeholder: 'Выберите язык',
  },
}

export default meta
type Story = StoryObj<typeof Select>

export const Default: Story = {
  render: (args) => {
    const Controlled = (): ReturnType<typeof Select> => {
      const [value, setValue] = useState<string | null>(null)
      return <Select {...args} value={value} onChange={setValue} />
    }
    return <Controlled />
  },
}

export const Preselected: Story = { args: { value: 'tj' } }

export const ErrorState: Story = { args: { error: 'Выберите язык' } }
