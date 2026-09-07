import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Card } from '../card/card.js'
import { CursorList } from './cursor-list.js'

interface Offer {
  readonly id: string
  readonly pharmacyName: string
  readonly priceSomoni: number
}

const OFFER_COUNT = 6
const BASE_PRICE_SOMONI = 25
const PRICE_STEP_SOMONI = 3
const LOAD_MORE_DELAY_MS = 400

const ALL_OFFERS: readonly Offer[] = Array.from({ length: OFFER_COUNT }, (_, index) => ({
  id: `offer-${String(index)}`,
  pharmacyName: `Аптека №${String(index + 1)}`,
  priceSomoni: BASE_PRICE_SOMONI + index * PRICE_STEP_SOMONI,
}))

const PAGE_SIZE = 2

/** `CursorList` домен-агностичен — `renderItem`/`getItemKey` определяет потребитель (здесь —
 * карточка оффера аптеки). Пустое состояние НЕ рисуется компонентом (DTJ-409, EmptyState —
 * ответственность потребителя). */
const meta: Meta<typeof CursorList<Offer>> = {
  title: 'Components/CursorList',
  component: CursorList<Offer>,
}

export default meta
type Story = StoryObj<typeof CursorList<Offer>>

export const Interactive: Story = {
  render: () => {
    const InteractiveCursorList = (): ReturnType<typeof CursorList<Offer>> => {
      const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
      const visibleOffers = ALL_OFFERS.slice(0, visibleCount)
      const nextCursor = visibleCount < ALL_OFFERS.length ? String(visibleCount) : null

      return (
        <CursorList
          items={visibleOffers}
          getItemKey={(offer) => offer.id}
          nextCursor={nextCursor}
          onLoadMore={() =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                setVisibleCount((current) => Math.min(current + PAGE_SIZE, ALL_OFFERS.length))
                resolve()
              }, LOAD_MORE_DELAY_MS)
            })
          }
          loadMoreLabel="Показать ещё"
          skeletonRowCount={1}
          renderItem={(offer) => (
            <Card>
              <strong>{offer.pharmacyName}</strong> — {offer.priceSomoni} сомони
            </Card>
          )}
        />
      )
    }

    return <InteractiveCursorList />
  },
}

export const NoMorePages: Story = {
  args: {
    items: ALL_OFFERS.slice(0, PAGE_SIZE),
    getItemKey: (offer) => offer.id,
    nextCursor: null,
    onLoadMore: () => undefined,
    loadMoreLabel: 'Показать ещё',
    renderItem: (offer) => (
      <Card>
        <strong>{offer.pharmacyName}</strong> — {offer.priceSomoni} сомони
      </Card>
    ),
  },
}
