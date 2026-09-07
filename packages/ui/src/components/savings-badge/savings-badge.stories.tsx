import type { Meta, StoryObj } from '@storybook/react-vite'
import { useT } from '@dorutj/i18n'
import { SavingsBadge } from './savings-badge.js'

const { t } = useT('ru')

/** Пояснение — ОБЯЗАТЕЛЬНЫЙ проп, изолированная цифра запрещена (REQ-UX-1, DTJ-407 п.2). */
const meta: Meta<typeof SavingsBadge> = {
  title: 'Components/SavingsBadge',
  component: SavingsBadge,
  args: {
    savingsDiram: 6500,
    locale: 'ru',
    t,
    explanation: 'Найден аналог с тем же действующим веществом рядом с вами',
  },
}

export default meta
type Story = StoryObj<typeof SavingsBadge>

export const Default: Story = {}

export const SmallSavings: Story = { args: { savingsDiram: 50 } }
