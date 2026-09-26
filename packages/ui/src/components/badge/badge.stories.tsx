/** `badge.stories.tsx` (DTJ-404). */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { Badge } from './badge'

const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
  args: { children: 'Оплачено' },
}

export default meta
type Story = StoryObj<typeof Badge>

export const Success: Story = { args: { tone: 'success' } }
export const Danger: Story = { args: { tone: 'danger', children: 'Отменён' } }
export const Warning: Story = { args: { tone: 'warning', children: 'Ожидает оплаты' } }
export const Neutral: Story = { args: { tone: 'neutral', children: 'Новый' } }
