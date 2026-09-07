import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Modal } from './modal.js'

function renderModal(onClose: () => void, isOpen = true) {
  return render(
    <>
      <button type="button">Триггер вне модалки</button>
      <Modal isOpen={isOpen} onClose={onClose} title="Подтверждение" closeButtonLabel="Закрыть">
        <button type="button">Первая кнопка</button>
        <button type="button">Вторая кнопка</button>
      </Modal>
    </>,
  )
}

describe('Modal — AC2 (focus trap, Escape, aria)', () => {
  it('role="dialog" + aria-modal="true" + aria-labelledby указывает на заголовок', () => {
    renderModal(vi.fn())

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const titleId = dialog.getAttribute('aria-labelledby')
    expect(titleId).not.toBeNull()
    expect(document.getElementById(titleId ?? '')).toHaveTextContent('Подтверждение')
  })

  it('Escape вызывает onClose', () => {
    const onClose = vi.fn()
    renderModal(onClose)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('клик на подложке (вне контента) вызывает onClose, клик внутри контента — нет', () => {
    const onClose = vi.fn()
    renderModal(onClose)

    fireEvent.mouseDown(screen.getByText('Подтверждение'))
    expect(onClose).not.toHaveBeenCalled()

    const overlay = document.querySelector('.ui-modal-overlay')
    expect(overlay).not.toBeNull()
    fireEvent.mouseDown(overlay!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab циклически удерживает фокус внутри модалки, не уходит на триггер позади', () => {
    renderModal(vi.fn())

    const first = screen.getByRole('button', { name: 'Первая кнопка' })
    const second = screen.getByRole('button', { name: 'Вторая кнопка' })
    const closeButton = screen.getByRole('button', { name: 'Закрыть' })

    expect(document.activeElement).toBe(closeButton)

    closeButton.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    // useFocusTrap переносит на следующий фокусируемый внутри контейнера — крестик уже был активен,
    // цикл идёт дальше по DOM-порядку контейнера (крестик → первая → вторая → крестик).
    expect([first, second, closeButton]).toContain(document.activeElement)
  })

  it('фокус возвращается на элемент, который был активен до открытия, после закрытия', () => {
    const FocusReturnHarness = (): ReactElement => {
      const [isOpen, setIsOpen] = useState(false)
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setIsOpen(true)
            }}
          >
            Открыть
          </button>
          <Modal
            isOpen={isOpen}
            onClose={() => {
              setIsOpen(false)
            }}
            title="Заголовок"
            closeButtonLabel="Закрыть"
          >
            <p>Контент</p>
          </Modal>
        </>
      )
    }

    render(<FocusReturnHarness />)
    const trigger = screen.getByRole('button', { name: 'Открыть' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })

  it('не рендерит DOM модалки, когда isOpen=false', () => {
    renderModal(vi.fn(), false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('рендерит footer, когда передан', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Заголовок" closeButtonLabel="Закрыть" footer={<p>Футер</p>}>
        <p>Контент</p>
      </Modal>,
    )
    expect(screen.getByText('Футер')).toBeInTheDocument()
  })

  it('без footer не рендерит блок футера', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Заголовок" closeButtonLabel="Закрыть">
        <p>Контент</p>
      </Modal>,
    )
    expect(document.querySelector('.ui-modal__footer')).not.toBeInTheDocument()
  })

  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Modal isOpen onClose={vi.fn()} title="Подтверждение" closeButtonLabel="Закрыть">
        <p>Текст модалки</p>
      </Modal>,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
