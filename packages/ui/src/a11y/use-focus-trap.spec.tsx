/**
 * `use-focus-trap.spec.tsx` (DTJ-403, «Что сделать» п.2, тест-план тикета).
 */
import { type ReactElement, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { getFocusableElements, useFocusTrap } from './use-focus-trap'

interface TrapFixtureProps {
  readonly isActive: boolean
  readonly onClose?: () => void
  readonly withFocusable?: boolean
}

const TrapFixture = ({ isActive, onClose, withFocusable = true }: TrapFixtureProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, isActive, onClose)
  return (
    <div>
      <button type="button">outside-before</button>
      <div ref={containerRef} tabIndex={-1} data-testid="container">
        {withFocusable ? (
          <>
            <button type="button">first</button>
            <button type="button">second</button>
            <button type="button">last</button>
          </>
        ) : (
          'нет фокусируемых элементов внутри'
        )}
      </div>
      <button type="button">outside-after</button>
    </div>
  )
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element on activation', () => {
    render(<TrapFixture isActive />)
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('focuses the container itself when it has no focusable children', () => {
    render(<TrapFixture isActive withFocusable={false} />)
    expect(screen.getByTestId('container')).toHaveFocus()
  })

  it('does nothing when inactive', () => {
    render(<TrapFixture isActive={false} />)
    expect(document.body).toHaveFocus()
  })

  it('cycles Tab from the last element back to the first', () => {
    render(<TrapFixture isActive />)
    screen.getByText('last').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('cycles Shift+Tab from the first element back to the last', () => {
    render(<TrapFixture isActive />)
    expect(screen.getByText('first')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('last')).toHaveFocus()
  })

  it('pulls focus back inside when it somehow escaped the container', () => {
    render(<TrapFixture isActive />)
    screen.getByText('outside-before').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    render(<TrapFixture isActive onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the previously focused element on deactivation', () => {
    const outsideBefore = document.createElement('button')
    outsideBefore.textContent = 'external'
    document.body.appendChild(outsideBefore)
    outsideBefore.focus()

    const { rerender } = render(<TrapFixture isActive={false} />)
    rerender(<TrapFixture isActive />)
    expect(screen.getByText('first')).toHaveFocus()

    rerender(<TrapFixture isActive={false} />)
    expect(outsideBefore).toHaveFocus()
  })

  it('excludes elements marked aria-hidden or inert from the tab order', () => {
    const container = document.createElement('div')
    container.innerHTML =
      '<button id="a">a</button><button id="b" aria-hidden="true">b</button><button id="c" inert>c</button>'
    document.body.appendChild(container)
    const focusable = getFocusableElements(container)
    expect(focusable.map((element) => element.id)).toEqual(['a'])
  })
})
