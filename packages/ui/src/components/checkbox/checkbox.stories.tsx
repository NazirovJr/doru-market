import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Checkbox } from './checkbox.js'

/** Визуально 20×20px, эффективная область клика ≥48×48px через hit-slop (`SRS-UX-002`, `AC5`). */
const meta: Meta<typeof Checkbox> = {
  title: 'Components/Checkbox',
  component: Checkbox,
  args: {
    label: 'Согласен с условиями обработки данных',
    checked: false,
  },
}

export default meta
type Story = StoryObj<typeof Checkbox>

export const Unchecked: Story = {}

export const Checked: Story = { args: { checked: true } }

export const Disabled: Story = { args: { disabled: true } }

export const Interactive: Story = {
  render: (args) => {
    const InteractiveCheckbox = (): ReturnType<typeof Checkbox> => {
      const [checked, setChecked] = useState(false)
      return (
        <Checkbox
          {...args}
          checked={checked}
          onChange={(event) => {
            setChecked(event.target.checked)
          }}
        />
      )
    }
    return <InteractiveCheckbox />
  },
}
