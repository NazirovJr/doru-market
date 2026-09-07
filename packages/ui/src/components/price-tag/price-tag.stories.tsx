import type { Meta, StoryObj } from '@storybook/react-vite'
import { PriceTag } from './price-tag.js'

/** Целые дирамы на входе (`amountDiram`), форматирование — `formatMoney()` (DTJ-402). */
const meta: Meta<typeof PriceTag> = {
  title: 'Components/PriceTag',
  component: PriceTag,
  args: {
    amountDiram: 12050,
    locale: 'ru',
  },
}

export default meta
type Story = StoryObj<typeof PriceTag>

export const Default: Story = {}

export const Strikethrough: Story = { args: { strikethrough: true } }

/** Пара «было/стало» — два `PriceTag` рядом, компоновку задаёт консьюмер. */
export const WasNowPair: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
      <PriceTag amountDiram={15000} locale="ru" strikethrough />
      <PriceTag amountDiram={9900} locale="ru" />
    </div>
  ),
}

export const Tajik: Story = { args: { locale: 'tj' } }

export const English: Story = { args: { locale: 'en' } }
