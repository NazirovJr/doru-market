import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { NewOrderBanner } from './NewOrderBanner'

describe('<NewOrderBanner /> (DTJ-310)', () => {
  it('orderNumber === null — ничего не рендерит', () => {
    const { container } = render(
      <LocaleProvider>
        <NewOrderBanner orderNumber={null} onDismiss={vi.fn()} />
      </LocaleProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('показывает номер заказа, клик «скрыть» вызывает onDismiss', () => {
    const onDismiss = vi.fn()
    render(
      <LocaleProvider>
        <NewOrderBanner orderNumber="DTJ-260925-00007" onDismiss={onDismiss} />
      </LocaleProvider>,
    )

    expect(screen.getByTestId('new-order-banner')).toHaveTextContent('DTJ-260925-00007')
    fireEvent.click(screen.getByTestId('new-order-banner-dismiss'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
