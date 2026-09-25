/** `textarea.stories.tsx` (DTJ-404). */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { Textarea } from './textarea'

const meta: Meta<typeof Textarea> = {
  title: 'Components/Textarea',
  component: Textarea,
  args: { label: 'Комментарий к заказу', placeholder: 'Например: позвонить перед доставкой' },
}

export default meta
type Story = StoryObj<typeof Textarea>

export const Default: Story = {}
export const WithError: Story = { args: { error: 'Слишком длинный комментарий' } }
