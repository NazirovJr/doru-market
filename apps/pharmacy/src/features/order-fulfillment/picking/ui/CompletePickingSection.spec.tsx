import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CompletePickingSection } from './CompletePickingSection'

describe('<CompletePickingSection /> (DTJ-312)', () => {
  it('чекбокс НЕ отмечен по умолчанию — кнопка задизейблена, даже если canComplete=true', () => {
    render(<CompletePickingSection canComplete={true} sealConfirmed={false} onSealConfirmedChange={vi.fn()} onComplete={vi.fn()} isCompleting={false} errorMessage={null} />)
    expect(screen.getByTestId('complete-picking-cta')).toHaveAttribute('aria-disabled', 'true')
  })

  it('canComplete=false — кнопка задизейблена, даже если чекбокс отмечен', () => {
    render(<CompletePickingSection canComplete={false} sealConfirmed={true} onSealConfirmedChange={vi.fn()} onComplete={vi.fn()} isCompleting={false} errorMessage={null} />)
    expect(screen.getByTestId('complete-picking-cta')).toHaveAttribute('aria-disabled', 'true')
  })

  it('canComplete=true И sealConfirmed=true — кнопка активна, клик вызывает onComplete', () => {
    const onComplete = vi.fn()
    render(<CompletePickingSection canComplete={true} sealConfirmed={true} onSealConfirmedChange={vi.fn()} onComplete={onComplete} isCompleting={false} errorMessage={null} />)
    const button = screen.getByTestId('complete-picking-cta')
    expect(button).not.toHaveAttribute('aria-disabled')
    fireEvent.click(button)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('клик по чекбоксу вызывает onSealConfirmedChange с новым значением', () => {
    const onSealConfirmedChange = vi.fn()
    render(<CompletePickingSection canComplete={true} sealConfirmed={false} onSealConfirmedChange={onSealConfirmedChange} onComplete={vi.fn()} isCompleting={false} errorMessage={null} />)
    fireEvent.click(screen.getByLabelText('Бастабандӣ мӯҳр карда шудааст'))
    expect(onSealConfirmedChange).toHaveBeenCalledWith(true)
  })

  it('errorMessage задан — inline-ошибка видна', () => {
    render(<CompletePickingSection canComplete={true} sealConfirmed={true} onSealConfirmedChange={vi.fn()} onComplete={vi.fn()} isCompleting={false} errorMessage="Партия истекла" />)
    expect(screen.getByTestId('complete-picking-error')).toHaveTextContent('Партия истекла')
  })
})
