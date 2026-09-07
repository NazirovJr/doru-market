import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button.js'

/** Витрина `Button` — все 4 варианта × все 7 состояний `SRS-UX-019` (`default/hover/active/focus/
 * disabled/loading` рендерятся статично для addon-a11y; `hover`/`active`/`focus` проверяются
 * интерактивно через Storybook controls/фокус клавиатурой, не отдельными story-снимками). */
const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  args: {
    children: 'Оформить заказ',
    variant: 'primary',
    size: 'md',
  },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'danger', 'ghost'] },
    size: { control: 'select', options: ['md', 'lg'] },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = {}

export const Secondary: Story = { args: { variant: 'secondary' } }

export const Danger: Story = { args: { variant: 'danger' } }

export const Ghost: Story = { args: { variant: 'ghost' } }

export const Large: Story = { args: { size: 'lg' } }

export const Loading: Story = { args: { loading: true } }

export const Disabled: Story = { args: { disabled: true } }

export const AllVariants: Story = {
  render: (args) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
      {(['primary', 'secondary', 'danger', 'ghost'] as const).map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
}
