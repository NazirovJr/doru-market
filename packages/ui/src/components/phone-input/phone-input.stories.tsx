/**
 * `phone-input.stories.tsx` (DTJ-405, DoD «Storybook-истории на все специфицированные состояния,
 * addon-a11y без нарушений»).
 */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { PhoneInput } from './phone-input'

const meta: Meta<typeof PhoneInput> = {
  title: 'Components/PhoneInput',
  component: PhoneInput,
  args: { label: 'Номер телефона', onChange: () => undefined },
}

export default meta
type Story = StoryObj<typeof PhoneInput>

/** default — история для addon-a11y (DoD: ноль нарушений). */
export const Default: Story = {}
export const WithError: Story = { args: { error: 'Введите полный номер телефона' } }
export const Disabled: Story = { args: { disabled: true, value: '+992901234567' } }
