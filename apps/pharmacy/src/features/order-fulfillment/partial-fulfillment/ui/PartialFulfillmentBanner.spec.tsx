import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { PartialFulfillmentBanner } from './PartialFulfillmentBanner'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> => rtlRender(ui, { wrapper: LocaleProvider })

describe('<PartialFulfillmentBanner /> (DTJ-312)', () => {
  it('canPropose=false, isAwaiting=false — ничего не рендерит', () => {
    render(<PartialFulfillmentBanner canPropose={false} isAwaiting={false} onPropose={vi.fn()} isProposing={false} proposeErrorMessage={null} />)
    expect(screen.queryByTestId('partial-fulfillment-propose-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('partial-fulfillment-awaiting-banner')).not.toBeInTheDocument()
  })

  it('canPropose=true — кнопка предложения, клик вызывает onPropose', () => {
    const onPropose = vi.fn()
    render(<PartialFulfillmentBanner canPropose={true} isAwaiting={false} onPropose={onPropose} isProposing={false} proposeErrorMessage={null} />)
    fireEvent.click(screen.getByTestId('partial-fulfillment-propose-cta'))
    expect(onPropose).toHaveBeenCalledTimes(1)
  })

  it('proposeErrorMessage задан — inline-ошибка рядом с кнопкой', () => {
    render(
      <PartialFulfillmentBanner canPropose={true} isAwaiting={false} onPropose={vi.fn()} isProposing={false} proposeErrorMessage="Не удалось отправить предложение клиенту" />,
    )
    expect(screen.getByTestId('partial-fulfillment-propose-error')).toHaveTextContent('Не удалось отправить предложение клиенту')
  })

  it('isAwaiting=true — баннер ожидания вместо кнопки предложения, даже если canPropose всё ещё true', () => {
    render(<PartialFulfillmentBanner canPropose={true} isAwaiting={true} onPropose={vi.fn()} isProposing={false} proposeErrorMessage={null} />)
    expect(screen.getByTestId('partial-fulfillment-awaiting-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('partial-fulfillment-propose-cta')).not.toBeInTheDocument()
  })
})
