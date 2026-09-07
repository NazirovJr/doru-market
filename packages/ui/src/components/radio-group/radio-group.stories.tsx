import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { RadioGroup } from './radio-group.js'

const OPTIONS = [
  { value: 'card', label: 'Картой онлайн' },
  { value: 'cash', label: 'Наличными курьеру' },
]

/** `role="radiogroup"`, навигация стрелками — нативное поведение `<input type="radio">`
 * (`SRS-UX-021`). */
const meta: Meta<typeof RadioGroup> = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  args: {
    name: 'payment',
    label: 'Способ оплаты',
    options: OPTIONS,
    value: null,
  },
}

export default meta
type Story = StoryObj<typeof RadioGroup>

export const Default: Story = {
  render: (args) => {
    const Controlled = (): ReturnType<typeof RadioGroup> => {
      const [value, setValue] = useState<string | null>(null)
      return <RadioGroup {...args} value={value} onChange={setValue} />
    }
    return <Controlled />
  },
}

export const Preselected: Story = { args: { value: 'card' } }
