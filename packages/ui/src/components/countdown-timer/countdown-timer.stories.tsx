import type { Meta, StoryObj } from '@storybook/react-vite'
import { CountdownTimer } from './countdown-timer.js'

/** Пороги — ОБЯЗАТЕЛЬНЫЕ пропы (не хардкод внутри компонента, тикет DTJ-407 п.6). */
const meta: Meta<typeof CountdownTimer> = {
  title: 'Components/CountdownTimer',
  component: CountdownTimer,
  args: {
    warningThresholdSeconds: 300,
    dangerThresholdSeconds: 0,
  },
}

export default meta
type Story = StoryObj<typeof CountdownTimer>

const NORMAL_OFFSET_MS = 400_000
const WARNING_OFFSET_MS = 250_000
const OVERDUE_OFFSET_MS = 65_000

export const Normal: Story = { args: { targetTimestamp: Date.now() + NORMAL_OFFSET_MS } }

export const Warning: Story = { args: { targetTimestamp: Date.now() + WARNING_OFFSET_MS } }

export const Overdue: Story = { args: { targetTimestamp: Date.now() - OVERDUE_OFFSET_MS } }
