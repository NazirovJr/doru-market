/** `skeleton.stories.tsx` (DTJ-404). */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { Skeleton } from './skeleton'

const meta: Meta<typeof Skeleton> = {
  title: 'Components/Skeleton',
  component: Skeleton,
}

export default meta
type Story = StoryObj<typeof Skeleton>

export const Text: Story = { args: { variant: 'text' } }
export const Row: Story = { args: { variant: 'row' } }
export const Card: Story = { args: { variant: 'card' } }
