import type { Meta, StoryObj } from '@storybook/react-vite'
import { OrderTimeline, type OrderTimelineStep } from './order-timeline.js'

const steps: readonly OrderTimelineStep[] = [
  { id: 'created', status: 'Заказ создан', timestamp: '07.09.2026, 10:00', isCompleted: true, isCurrent: false },
  { id: 'confirmed', status: 'Подтверждён аптекой', timestamp: '07.09.2026, 10:05', isCompleted: true, isCurrent: false },
  { id: 'ready', status: 'Готов к выдаче', isCompleted: false, isCurrent: true },
  { id: 'picked_up', status: 'Выдан', isCompleted: false, isCurrent: false },
]

const meta: Meta<typeof OrderTimeline> = {
  title: 'Components/OrderTimeline',
  component: OrderTimeline,
  args: { steps },
}

export default meta
type Story = StoryObj<typeof OrderTimeline>

export const Default: Story = {}

export const Completed: Story = {
  args: {
    steps: steps.map((step) => ({ ...step, isCompleted: true, isCurrent: false })),
  },
}
