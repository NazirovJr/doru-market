import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OfflineBanner } from './OfflineBanner'

describe('<OfflineBanner /> (DTJ-310, SRS-UX-025)', () => {
  it('visible=false — ничего не рендерит', () => {
    const { container } = render(<OfflineBanner visible={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('visible=true — показывает сообщение «Нет соединения»', () => {
    render(<OfflineBanner visible />)
    expect(screen.getByTestId('order-queue-offline-banner')).toBeInTheDocument()
  })
})
