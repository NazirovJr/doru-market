import type { Meta, StoryObj } from '@storybook/react-vite'
import { useT } from '@dorutj/i18n'
import { PharmacyOfferRow } from '../pharmacy-offer-row/pharmacy-offer-row.js'
import { MedicineCard } from './medicine-card.js'

const { t } = useT('ru')

const meta: Meta<typeof MedicineCard> = {
  title: 'Components/MedicineCard',
  component: MedicineCard,
  args: {
    tradeName: 'Каптоприл',
    innName: 'Captopril',
    dosageForm: 'таблетки',
    manufacturerName: 'Pharmstandard',
    priceDiram: 5000,
    locale: 'ru',
    distanceLabel: '500 м',
    stockLabel: 'В наличии',
    controlCategory: 'none',
    onClick: () => {
      /* переход на карточку товара — навигацию делает потребитель-фича */
    },
  },
}

export default meta
type Story = StoryObj<typeof MedicineCard>

export const Default: Story = {}

export const Prescription: Story = {
  args: { controlCategory: 'potent', rxBadgeLabel: 'Требуется рецепт' },
}

export const WithOfferRow: Story = {
  render: (args) => (
    <MedicineCard {...args}>
      <PharmacyOfferRow pharmacyName="Аптека №1" priceDiram={5000} locale="ru" t={t} ctaLabel="В корзину" />
    </MedicineCard>
  ),
}
