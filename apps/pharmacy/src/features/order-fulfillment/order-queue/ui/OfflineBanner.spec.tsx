import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { OfflineBanner } from './OfflineBanner'

describe('<OfflineBanner /> (DTJ-310, SRS-UX-025)', () => {
  it('visible=false — ничего не рендерит', () => {
    const { container } = render(
      <LocaleProvider>
        <OfflineBanner visible={false} />
      </LocaleProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('visible=true — показывает сообщение «Нет соединения»', () => {
    render(
      <LocaleProvider>
        <OfflineBanner visible />
      </LocaleProvider>,
    )
    expect(screen.getByTestId('order-queue-offline-banner')).toBeInTheDocument()
  })
})
