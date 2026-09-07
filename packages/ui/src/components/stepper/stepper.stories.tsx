import type { Meta, StoryObj } from '@storybook/react-vite'
import { Stepper, type StepItem } from './stepper.js'

/** Прогресс чекаута (адрес → оплата → подтверждение) — шаги домен-агностичны, потребитель
 * передаёт массив `{ label, status }`. */
const meta: Meta<typeof Stepper> = {
  title: 'Components/Stepper',
  component: Stepper,
  args: {
    'aria-label': 'Прогресс оформления заказа',
  },
}

export default meta
type Story = StoryObj<typeof Stepper>

const CHECKOUT_STEPS: readonly StepItem[] = [
  { label: 'Адрес', status: 'complete' },
  { label: 'Оплата', status: 'current' },
  { label: 'Подтверждение', status: 'upcoming' },
]

export const CheckoutInProgress: Story = { args: { steps: CHECKOUT_STEPS } }

export const AllComplete: Story = {
  args: {
    steps: CHECKOUT_STEPS.map((step) => ({ ...step, status: 'complete' })),
  },
}

export const FirstStep: Story = {
  args: {
    steps: [
      { label: 'Адрес', status: 'current' },
      { label: 'Оплата', status: 'upcoming' },
      { label: 'Подтверждение', status: 'upcoming' },
    ],
  },
}
