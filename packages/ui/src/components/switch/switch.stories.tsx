import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Switch } from './switch.js'

/** `role="switch"` + `aria-checked`, анимация переключения уважает `prefers-reduced-motion`
 * (`SRS-UX-021`). */
const meta: Meta<typeof Switch> = {
  title: 'Components/Switch',
  component: Switch,
  args: {
    label: 'Push-уведомления',
    checked: false,
  },
}

export default meta
type Story = StoryObj<typeof Switch>

export const Off: Story = {}

export const On: Story = { args: { checked: true } }

export const Disabled: Story = { args: { disabled: true } }

export const Interactive: Story = {
  render: (args) => {
    const InteractiveSwitch = (): ReturnType<typeof Switch> => {
      const [checked, setChecked] = useState(false)
      return <Switch {...args} checked={checked} onChange={setChecked} />
    }
    return <InteractiveSwitch />
  },
}
