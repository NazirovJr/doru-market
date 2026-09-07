import type { Meta, StoryObj } from '@storybook/react-vite'
import { Skeleton } from './skeleton.js'

/** Формы под строку/карточку/чип (`SRS-UX-021`). Shimmer уважает `prefers-reduced-motion` —
 * переключите эмуляцию в Storybook toolbar/браузере, чтобы увидеть статичный фон. */
const meta: Meta<typeof Skeleton> = {
  title: 'Components/Skeleton',
  component: Skeleton,
}

export default meta
type Story = StoryObj<typeof Skeleton>

export const Text: Story = { args: { variant: 'text' } }

export const Row: Story = { args: { variant: 'row' } }

export const Card: Story = { args: { variant: 'card' } }
