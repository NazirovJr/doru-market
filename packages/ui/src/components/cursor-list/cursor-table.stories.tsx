import type { Meta, StoryObj } from '@storybook/react-vite'
import { CursorTable, type CursorTableColumn } from './cursor-table.js'

interface Order {
  readonly id: string
  readonly number: string
  readonly pharmacyName: string
  readonly totalSomoni: number
  readonly deliveryAddress: string
}

const ORDER_COUNT = 4
const ORDER_NUMBER_BASE = 1000
const BASE_TOTAL_SOMONI = 45
const TOTAL_STEP_SOMONI = 12

const ORDERS: readonly Order[] = Array.from({ length: ORDER_COUNT }, (_, index) => ({
  id: `order-${String(index)}`,
  number: `ORD-${String(ORDER_NUMBER_BASE + index)}`,
  pharmacyName: `Аптека «Салют» филиал №${String(index + 1)}`,
  totalSomoni: BASE_TOTAL_SOMONI + index * TOTAL_STEP_SOMONI,
  deliveryAddress: 'г. Душанбе, ул. Рудаки, дом 25, подъезд 3, этаж 4, квартира 12 — очень длинный адрес для проверки горизонтального скролла',
}))

const COLUMNS: readonly CursorTableColumn<Order>[] = [
  { id: 'number', header: 'Номер заказа', renderCell: (order) => order.number },
  { id: 'pharmacy', header: 'Аптека', renderCell: (order) => order.pharmacyName },
  { id: 'address', header: 'Адрес доставки', renderCell: (order) => order.deliveryAddress },
  { id: 'total', header: 'Сумма', renderCell: (order) => `${String(order.totalSomoni)} сомони` },
]

/** Заголовки НЕ теряются при горизонтальном скролле (`SRS-UX-034`) — сузьте вьюпорт Storybook,
 * чтобы увидеть скролл именно на обёртке таблицы, не на всей странице. */
const meta: Meta<typeof CursorTable<Order>> = {
  title: 'Components/CursorTable',
  component: CursorTable<Order>,
  args: {
    items: ORDERS,
    columns: COLUMNS,
    getItemKey: (order) => order.id,
    nextCursor: null,
    onLoadMore: () => undefined,
    loadMoreLabel: 'Показать ещё',
  },
}

export default meta
type Story = StoryObj<typeof CursorTable<Order>>

export const Default: Story = {}

export const WithMorePages: Story = {
  args: {
    nextCursor: 'cursor-2',
  },
}
