import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Chip } from './chip.js'

/** Визуально 32px высотой, эффективная область клика ≥48×48px через hit-slop (`SRS-UX-002`,
 * расхождение №4 `32-design-reference.md`, AC4). */
const meta: Meta<typeof Chip> = {
  title: 'Components/Chip',
  component: Chip,
  args: {
    children: 'В наличии',
    selected: false,
  },
}

export default meta
type Story = StoryObj<typeof Chip>

export const Unselected: Story = {}

export const Selected: Story = { args: { selected: true } }

export const Interactive: Story = {
  render: (args) => {
    const InteractiveChip = (): ReturnType<typeof Chip> => {
      const [selected, setSelected] = useState(false)
      return (
        <Chip
          {...args}
          selected={selected}
          onClick={() => {
            setSelected((current) => !current)
          }}
        />
      )
    }
    return <InteractiveChip />
  },
}
