import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PharmacyTerminalQueueItemDto } from '@dorutj/contracts'
import { OrderCard } from './OrderCard'

function makeItem(overrides: Partial<PharmacyTerminalQueueItemDto>): PharmacyTerminalQueueItemDto {
  return {
    id: 'order-1',
    orderNumber: 'DTJ-260925-00001',
    status: 'paid_escrow',
    itemsCount: 1,
    itemsTotalTjs: 100,
    paymentMethod: 'alif_mobi',
    prescriptionRequired: true,
    slaDeadlineAt: null,
    assignedPharmacistId: null,
    assignedPharmacistName: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}

function renderCard(item: PharmacyTerminalQueueItemDto, currentUserId = 'me'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ul>
        <OrderCard item={item} currentUserId={currentUserId} onAccept={vi.fn()} isAccepting={false} />
      </ul>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 })))
})

describe('<OrderCard /> (DTJ-310)', () => {
  it('заказ «Новые» — показывает «Принять», рецептурный бейдж, тап-зона критичного CTA ≥56px', () => {
    renderCard(makeItem({ status: 'paid_escrow' }))
    const acceptButton = screen.getByTestId('order-card-accept-cta')
    expect(acceptButton).toBeInTheDocument()
    expect(acceptButton.className).toContain('min-h-[56px]')
    expect(screen.getByTestId('order-card-rx-badge')).toBeInTheDocument()
  })

  it('«В сборке», занят мной — показывает «Ваша сборка», «Принять» скрыта, кнопка перехвата отсутствует', () => {
    renderCard(makeItem({ status: 'processing', assignedPharmacistId: 'me' }))
    expect(screen.queryByTestId('order-card-accept-cta')).not.toBeInTheDocument()
    expect(screen.getByTestId('order-card-own-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('order-card-reclaim-toggle')).not.toBeInTheDocument()
  })

  it('«В сборке», занят коллегой — «Принять» скрыта, показан бейдж с именем и кнопка «Перехватить»', () => {
    renderCard(makeItem({ status: 'processing', assignedPharmacistId: 'colleague-1', assignedPharmacistName: 'Фарзона М.' }))
    expect(screen.queryByTestId('order-card-accept-cta')).not.toBeInTheDocument()
    expect(screen.getByTestId('order-card-assigned-badge')).toHaveTextContent('Фарзона М.')
    expect(screen.getByTestId('order-card-reclaim-toggle')).toBeInTheDocument()
  })

  it('клик «Перехватить» открывает ReclaimMenu, повторный клик закрывает', () => {
    renderCard(makeItem({ status: 'processing', assignedPharmacistId: 'colleague-1' }))
    const toggle = screen.getByTestId('order-card-reclaim-toggle')

    fireEvent.click(toggle)
    expect(screen.getByTestId('reclaim-menu')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByTestId('reclaim-menu')).not.toBeInTheDocument()
  })
})
