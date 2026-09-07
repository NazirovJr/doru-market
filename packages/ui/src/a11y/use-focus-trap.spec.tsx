import { useRef, type JSX, type RefObject } from 'react'
import { fireEvent, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFocusTrap } from './use-focus-trap'

const TrapHarness = ({
  isActive,
  onClose,
}: {
  isActive: boolean
  onClose?: () => void
}): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, isActive, onClose)

  return (
    <div>
      <button type="button">outside</button>
      <div ref={containerRef}>
        <button type="button">first</button>
        <button type="button">second</button>
      </div>
    </div>
  )
}

const EmptyTrapHarness = ({ isActive }: { isActive: boolean }): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, isActive)

  return <div ref={containerRef} />
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element on activation', () => {
    const { getByText } = render(<TrapHarness isActive />)

    expect(document.activeElement).toBe(getByText('first'))
  })

  it('cycles Tab from the last element back to the first', () => {
    const { getByText } = render(<TrapHarness isActive />)
    const last = getByText('second')
    last.focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(getByText('first'))
  })

  it('cycles Shift+Tab from the first element to the last', () => {
    const { getByText } = render(<TrapHarness isActive />)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(getByText('second'))
  })

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    render(<TrapHarness isActive onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the previously focused element on deactivation', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    const { rerender } = render(<TrapHarness isActive={false} />)
    rerender(<TrapHarness isActive />)
    rerender(<TrapHarness isActive={false} />)

    expect(document.activeElement).toBe(outside)
    document.body.removeChild(outside)
  })

  it('does nothing when containerRef.current is null', () => {
    const containerRef = { current: null } as RefObject<HTMLElement | null>

    expect(() => {
      renderHook(() => {
        useFocusTrap(containerRef, true)
      })
    }).not.toThrow()
  })

  it('Tab inside a container with no focusable elements only prevents default', () => {
    render(<EmptyTrapHarness isActive />)

    expect(() => fireEvent.keyDown(document, { key: 'Tab' })).not.toThrow()
  })

  it('ignores keys other than Tab/Escape', () => {
    const onClose = vi.fn()
    const { getByText } = render(<TrapHarness isActive onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'a' })

    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(getByText('first'))
  })

  it('Tab from outside the container wraps focus back to the first element', () => {
    const { getByText } = render(<TrapHarness isActive />)
    getByText('outside').focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(getByText('first'))
  })

  it('Shift+Tab from outside the container wraps focus to the last element', () => {
    const { getByText } = render(<TrapHarness isActive />)
    getByText('outside').focus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(getByText('second'))
  })

  it('treats a non-HTMLElement activeElement as "nothing was focused before"', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    document.body.appendChild(svg)
    Object.defineProperty(document, 'activeElement', { value: svg, configurable: true })

    expect(() => render(<TrapHarness isActive />)).not.toThrow()

    // @ts-expect-error -- возвращаем jsdom нативное поведение activeElement (18 симв.)
    delete document.activeElement
    document.body.removeChild(svg)
  })
})
