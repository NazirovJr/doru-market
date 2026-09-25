/**
 * `textarea.spec.tsx` (DTJ-404, тест-план тикета — тот же контракт `error`/`label`, что и `Input`).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Textarea } from './textarea'

afterEach(() => {
  cleanup()
})

describe('Textarea — связка label↔textarea', () => {
  it('label связан с textarea через htmlFor/id', () => {
    render(<Textarea label="Комментарий" />)
    expect(screen.getByLabelText('Комментарий')).toBeInTheDocument()
  })
})

describe('Textarea — error-состояние', () => {
  it('выставляет aria-invalid и aria-describedby с текстом ошибки и иконкой', () => {
    render(<Textarea label="Комментарий" error="Слишком длинно" />)
    const textarea = screen.getByLabelText('Комментарий')
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    const describedBy = textarea.getAttribute('aria-describedby')
    const errorNode = document.getElementById(describedBy ?? '')
    expect(errorNode).toHaveTextContent('Слишком длинно')
    expect(errorNode?.querySelector('svg')).not.toBeNull()
  })

  it('нулевые critical/serious нарушения доступности в error-состоянии', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Textarea label="Комментарий" error="Слишком длинно" />,
    )
    assertNoBlockingViolations(axeResults)
  })
})

describe('Textarea — focus (SRS-UX-019)', () => {
  it('показывает --focus-ring на фокусе и прокидывает переданные onFocus/onBlur', () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    render(<Textarea label="Комментарий" onFocus={onFocus} onBlur={onBlur} />)
    const textarea = screen.getByLabelText('Комментарий')
    fireEvent.focus(textarea)
    expect(getComputedStyle(textarea).boxShadow).toContain('var(--focus-ring)')
    expect(onFocus).toHaveBeenCalledTimes(1)
    fireEvent.blur(textarea)
    expect(getComputedStyle(textarea).boxShadow).toBe('none')
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})

describe('Textarea — контролируемый компонент', () => {
  it('onChange, не обновляющий состояние, не мутирует управляемое value', () => {
    render(<Textarea label="Комментарий" value="фикс" onChange={() => undefined} />)
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Комментарий')
    fireEvent.change(textarea, { target: { value: 'другое' } })
    expect(textarea.value).toBe('фикс')
  })
})
