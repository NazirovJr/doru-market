/**
 * `modal.spec.tsx` (DTJ-406, критерий приёмки 2, тест-план тикета) — покрывает `Modal` и
 * `BottomSheet` (делят `DialogShell`, см. её JSDoc).
 */
import { type ReactElement, useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { BottomSheet } from './bottom-sheet'
import { Modal } from './modal'

afterEach(() => {
  cleanup()
})

interface TriggerHarnessProps {
  readonly renderDialog: (isOpen: boolean, onClose: () => void) => ReactElement
}

/** Обёртка с триггер-кнопкой — проверяет возврат фокуса на триггер после закрытия. */
const TriggerHarness = ({ renderDialog }: TriggerHarnessProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(true)
        }}
      >
        open
      </button>
      {renderDialog(isOpen, () => {
        setIsOpen(false)
        triggerRef.current?.focus()
      })}
    </div>
  )
}

const CASES = [
  {
    name: 'Modal',
    render: (isOpen: boolean, onClose: () => void): ReactElement => (
      <Modal isOpen={isOpen} onClose={onClose} title="Заголовок" closeButtonLabel="Закрыть">
        <button type="button">first</button>
        <button type="button">last</button>
      </Modal>
    ),
  },
  {
    name: 'BottomSheet',
    render: (isOpen: boolean, onClose: () => void): ReactElement => (
      <BottomSheet isOpen={isOpen} onClose={onClose} title="Заголовок" closeButtonLabel="Закрыть">
        <button type="button">first</button>
        <button type="button">last</button>
      </BottomSheet>
    ),
  },
]

describe.each(CASES)('$name — рендер/доступность (AC2)', ({ render: renderDialog }) => {
  it('не рендерит DOM, пока isOpen=false', () => {
    render(renderDialog(false, () => undefined))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('role=dialog, aria-modal=true, aria-labelledby указывает на заголовок', () => {
    render(renderDialog(true, () => undefined))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    expect(document.getElementById(labelledBy ?? '')).toHaveTextContent('Заголовок')
  })

  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(renderDialog(true, () => undefined))
    assertNoBlockingViolations(axeResults)
  })
})

describe.each(CASES)('$name — фокус-трап и закрытие (AC2)', ({ render: renderDialog }) => {
  it('Escape вызывает onClose', () => {
    const onClose = vi.fn()
    render(renderDialog(true, onClose))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('клик по оверлею (не по панели) вызывает onClose', () => {
    const onClose = vi.fn()
    render(renderDialog(true, onClose))
    const overlay = screen.getByRole('dialog').parentElement!
    fireEvent.mouseDown(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('клик внутри панели НЕ вызывает onClose', () => {
    const onClose = vi.fn()
    render(renderDialog(true, onClose))
    fireEvent.mouseDown(screen.getByText('first'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('при открытии фокус переходит на первый фокусируемый элемент (кнопка закрытия — первая в DOM)', () => {
    render(renderDialog(true, () => undefined))
    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus()
  })

  it('Tab циклически возвращает фокус с последнего элемента на кнопку закрытия (первую в DOM)', () => {
    render(renderDialog(true, () => undefined))
    screen.getByText('last').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus()
  })

  it('Shift+Tab с первого элемента (кнопки закрытия) циклически уводит фокус на последний', () => {
    render(renderDialog(true, () => undefined))
    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('last')).toHaveFocus()
  })

  it('фокус возвращается на триггер-элемент после закрытия', () => {
    render(<TriggerHarness renderDialog={renderDialog} />)
    fireEvent.click(screen.getByText('open'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByText('open')).toHaveFocus()
  })
})

describe('BottomSheet — свайп вниз закрывает (жест)', () => {
  it('свайп вниз на хэндле дальше порога вызывает onClose', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={onClose} title="Заголовок" closeButtonLabel="Закрыть">
        <button type="button">content</button>
      </BottomSheet>,
    )
    const handle = screen.getByTestId('dorutj-bottom-sheet-handle')
    fireEvent.pointerDown(handle, { clientY: 0 })
    fireEvent.pointerUp(handle, { clientY: 200 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('небольшое смещение (ниже порога) НЕ вызывает onClose', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={onClose} title="Заголовок" closeButtonLabel="Закрыть">
        <button type="button">content</button>
      </BottomSheet>,
    )
    const handle = screen.getByTestId('dorutj-bottom-sheet-handle')
    fireEvent.pointerDown(handle, { clientY: 0 })
    fireEvent.pointerUp(handle, { clientY: 20 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('pointerCancel сбрасывает жест без закрытия', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={onClose} title="Заголовок" closeButtonLabel="Закрыть">
        <button type="button">content</button>
      </BottomSheet>,
    )
    const handle = screen.getByTestId('dorutj-bottom-sheet-handle')
    fireEvent.pointerDown(handle, { clientY: 0 })
    fireEvent.pointerCancel(handle)
    fireEvent.pointerUp(handle, { clientY: 200 })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Modal/BottomSheet — кнопка закрытия', () => {
  it.each(CASES)('$name — клик по кнопке закрытия вызывает onClose', ({ render: renderDialog }) => {
    const onClose = vi.fn()
    render(renderDialog(true, onClose))
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
