/** `chip.stories.tsx` (DTJ-404). */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { Chip } from './chip'

const meta: Meta<typeof Chip> = {
  title: 'Components/Chip',
  component: Chip,
  args: { children: 'В наличии', selected: false },
}

export default meta
type Story = StoryObj<typeof Chip>

export const Unselected: Story = {}
export const Selected: Story = { args: { selected: true } }
