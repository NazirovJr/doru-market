/**
 * `otp-input.stories.tsx` (DTJ-405, DoD «Storybook-истории на все специфицированные состояния,
 * addon-a11y без нарушений»).
 *
 * Известное ограничение платформы (риски тикета): `inputmode="numeric"` на некоторых
 * Android-клавиатурах показывает дополнительные символы (запятая/точка) — не решается на
 * уровне React-компонента, фиксируется здесь как заметка.
 */
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { OtpInput } from './otp-input'

const meta: Meta<typeof OtpInput> = {
  title: 'Components/OtpInput',
  component: OtpInput,
  args: { length: 6 },
  parameters: {
    docs: {
      description: {
        component:
          '`inputmode="numeric"` на части Android-клавиатур показывает лишние символы (`,`/`.`) — известное ограничение платформы, не решаемое на уровне компонента.',
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof OtpInput>

/** default — история для addon-a11y (DoD: ноль нарушений). Логин, 6 ячеек 44×54px. */
export const Login: Story = { args: { length: 6 } }
export const Courier: Story = { args: { length: 4 } }
export const Error: Story = { args: { length: 6, error: true } }
export const Locked: Story = { args: { length: 6, locked: true } }
