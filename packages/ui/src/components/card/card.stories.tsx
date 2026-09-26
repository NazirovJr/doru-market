/** `card.stories.tsx` (DTJ-404). */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { Card } from './card'

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
}

export default meta
type Story = StoryObj<typeof Card>

export const StaticCard: Story = { args: { children: 'Парацетамол 500мг, 20 таб.' } }
export const InteractiveCard: Story = {
  args: { interactive: true, 'aria-label': 'Открыть препарат', children: 'Парацетамол 500мг, 20 таб.' },
}
