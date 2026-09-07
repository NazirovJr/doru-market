import { fireEvent, render, screen } from '@testing-library/react'
import type { TouchEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { BottomSheet } from './bottom-sheet.js'
import { SWIPE_CLOSE_THRESHOLD_PX } from './use-swipe-to-close.js'

function renderSheet(onClose: () => void, isOpen = true) {
  return render(
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Аптеки рядом" closeButtonLabel="Закрыть">
      <button type="button">Пункт списка</button>
    </BottomSheet>,
  )
}

function touchAt(clientY: number) {
  return { touches: [{ clientY }] } as unknown as TouchEvent
}

describe('BottomSheet — паритет с Modal (AC2)', () => {
  it('role="dialog" + aria-modal="true" + aria-labelledby на заголовок', () => {
    renderSheet(vi.fn())
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const titleId = dialog.getAttribute('aria-labelledby')
    expect(document.getElementById(titleId ?? '')).toHaveTextContent('Аптеки рядом')
  })

  it('Escape вызывает onClose', () => {
    const onClose = vi.fn()
    renderSheet(onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('клик на подложке закрывает, клик внутри контента — нет', () => {
    const onClose = vi.fn()
    renderSheet(onClose)

    fireEvent.mouseDown(screen.getByText('Аптеки рядом'))
    expect(onClose).not.toHaveBeenCalled()

    const overlay = document.querySelector('.ui-bottom-sheet-overlay')!
    fireEvent.mouseDown(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('не рендерит DOM, когда isOpen=false', () => {
    renderSheet(vi.fn(), false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('рендерит footer, когда передан', () => {
    render(
      <BottomSheet isOpen onClose={vi.fn()} title="Заголовок" closeButtonLabel="Закрыть" footer={<p>Футер</p>}>
        <p>Контент</p>
      </BottomSheet>,
    )
    expect(screen.getByText('Футер')).toBeInTheDocument()
  })

  it('без footer не рендерит блок футера', () => {
    render(
      <BottomSheet isOpen onClose={vi.fn()} title="Заголовок" closeButtonLabel="Закрыть">
        <p>Контент</p>
      </BottomSheet>,
    )
    expect(document.querySelector('.ui-bottom-sheet__footer')).not.toBeInTheDocument()
  })

  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <BottomSheet isOpen onClose={vi.fn()} title="Аптеки рядом" closeButtonLabel="Закрыть">
        <p>Список</p>
      </BottomSheet>,
    )
    expect(axeResults).toHaveNoViolations()
  })
})

describe('BottomSheet — свайп вниз закрывает (DTJ-406 п.2)', () => {
  it(`свайп вниз > ${String(SWIPE_CLOSE_THRESHOLD_PX)}px вызывает onClose при отпускании`, () => {
    const onClose = vi.fn()
    renderSheet(onClose)
    const handleArea = document.querySelector('.ui-bottom-sheet__handle-area')!
    expect(handleArea).not.toBeNull()

    fireEvent.touchStart(handleArea, touchAt(100))
    fireEvent.touchMove(handleArea, touchAt(100 + SWIPE_CLOSE_THRESHOLD_PX + 1))
    fireEvent.touchEnd(handleArea)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it(`свайп вниз <= ${String(SWIPE_CLOSE_THRESHOLD_PX)}px НЕ закрывает`, () => {
    const onClose = vi.fn()
    renderSheet(onClose)
    const handleArea = document.querySelector('.ui-bottom-sheet__handle-area')!

    fireEvent.touchStart(handleArea, touchAt(100))
    fireEvent.touchMove(handleArea, touchAt(100 + SWIPE_CLOSE_THRESHOLD_PX - 1))
    fireEvent.touchEnd(handleArea)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('свайп вверх (delta отрицательная) не двигает шторку и не закрывает', () => {
    const onClose = vi.fn()
    renderSheet(onClose)
    const handleArea = document.querySelector('.ui-bottom-sheet__handle-area')!

    fireEvent.touchStart(handleArea, touchAt(200))
    fireEvent.touchMove(handleArea, touchAt(100))
    fireEvent.touchEnd(handleArea)

    expect(onClose).not.toHaveBeenCalled()
  })
})
