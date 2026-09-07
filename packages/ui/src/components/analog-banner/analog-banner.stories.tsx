import type { Meta, StoryObj } from '@storybook/react-vite'
import { useT } from '@dorutj/i18n'
import { AnalogBanner } from './analog-banner.js'

const { t } = useT('ru')

/** Дисклеймер (`catalog.analogs.disclaimer`) — текст `pending_legal_review`, рендерится ВСЕГДА
 * (SRS-CAT-039). Компонент inline, НЕ модаль (REQ-UX-2). */
const meta: Meta<typeof AnalogBanner> = {
  title: 'Components/AnalogBanner',
  component: AnalogBanner,
  args: {
    substanceName: 'Каптоприл',
    dosage: '25 мг',
    analogPriceDiram: 1250,
    referencePriceDiram: 2000,
    savingsPercent: 65,
    locale: 'ru',
    t,
  },
}

export default meta
type Story = StoryObj<typeof AnalogBanner>

export const Default: Story = {}

export const SmallSavings: Story = { args: { savingsPercent: 5, analogPriceDiram: 1900 } }
