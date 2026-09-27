/** `icon-button.stories.tsx` (DTJ-404). */
import { type ReactElement } from 'react'
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { IconButton } from './icon-button'

const CallIcon = (): ReactElement => (
  <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M4 3h3l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5v3c0 1-1 1.5-2 1.5C9 17.5 2.5 11 2.5 5c0-1 .5-2 1.5-2Z"
      fill="var(--brand-text)"
    />
  </svg>
)

const meta: Meta<typeof IconButton> = {
  title: 'Components/IconButton',
  component: IconButton,
  args: { icon: <CallIcon />, 'aria-label': 'Позвонить' },
}

export default meta
type Story = StoryObj<typeof IconButton>

export const Default: Story = {}
export const Disabled: Story = { args: { disabled: true } }
