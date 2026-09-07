import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { IconButton } from './icon-button.js'

const PhoneIcon = (): ReactElement => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M4 3h3l1.5 4L7 8.5a9 9 0 0 0 4.5 4.5L13 11.5l4 1.5v3a1 1 0 0 1-1.1 1C9 16.5 3.5 11 3 4.1A1 1 0 0 1 4 3Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)

/** `IconButton` требует `aria-label` пропсом (TypeScript, AC2) — истории демонстрируют оба
 * визуальных размера, тап-зона реально ≥48×48px в обоих (`SRS-UX-002`). */
const meta: Meta<typeof IconButton> = {
  title: 'Components/IconButton',
  component: IconButton,
  args: {
    icon: <PhoneIcon />,
    'aria-label': 'Позвонить курьеру',
  },
}

export default meta
type Story = StoryObj<typeof IconButton>

export const Default: Story = {}

export const Small: Story = { args: { size: 'sm', 'aria-label': 'Назад' } }

export const Disabled: Story = { args: { disabled: true } }
