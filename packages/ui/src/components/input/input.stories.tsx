/** `input.stories.tsx` (DTJ-404). */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { Input } from './input'

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  args: { label: 'Название препарата', placeholder: 'Парацетамол' },
}

export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {}
export const WithError: Story = { args: { error: 'Обязательное поле' } }
export const Disabled: Story = { args: { disabled: true, value: 'Парацетамол 500мг' } }
