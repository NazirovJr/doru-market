import type { Meta, StoryObj } from '@storybook/react-vite'
import { useT } from '@dorutj/i18n'
import { PharmacyOfferRow } from './pharmacy-offer-row.js'

const { t } = useT('ru')

const meta: Meta<typeof PharmacyOfferRow> = {
  title: 'Components/PharmacyOfferRow',
  component: PharmacyOfferRow,
  args: {
    pharmacyName: 'Аптека №1',
    priceDiram: 12550,
    locale: 'ru',
    distanceLabel: '500 м',
    stockLabel: 'В наличии',
    t,
    ctaLabel: 'В корзину',
  },
}

export default meta
type Story = StoryObj<typeof PharmacyOfferRow>

export const Default: Story = {}

export const Stale: Story = { args: { isStale: true, minutesAgo: 12 } }

export const OutOfStock: Story = { args: { stockLabel: undefined, ctaDisabled: true } }
