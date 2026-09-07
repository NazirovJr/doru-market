import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card } from './card.js'

/** `static` — обычный `<div>`, не фокусируется. `interactive` — `<a>`/`<button>` со своим
 * `--focus-ring` (`SRS-UX-021`). */
const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
}

export default meta
type Story = StoryObj<typeof Card>

export const StaticCard: Story = {
  args: { children: 'Парацетамол 500мг, 20 таблеток' },
}

export const InteractiveLink: Story = {
  args: { interactive: true, href: '/orders/1', children: 'Заказ №1 — в пути' },
}

export const InteractiveButton: Story = {
  args: { interactive: true, children: 'Открыть фильтры' },
}
