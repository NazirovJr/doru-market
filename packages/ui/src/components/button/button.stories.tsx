/**
 * `button.stories.tsx` (DTJ-404, DoD «Storybook-истории с демонстрацией всех состояний
 * `SRS-UX-019`»).
 */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { Button } from './button'

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Оформить заказ' },
}

export default meta
type Story = StoryObj<typeof Button>

/** default — история для addon-a11y (DoD: ноль нарушений). */
export const Default: Story = { args: { variant: 'primary', size: 'md' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Danger: Story = { args: { variant: 'danger', children: 'Отменить заказ' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Large: Story = { args: { size: 'lg' } }
export const Loading: Story = { args: { loading: true } }
export const Disabled: Story = { args: { disabled: true } }
