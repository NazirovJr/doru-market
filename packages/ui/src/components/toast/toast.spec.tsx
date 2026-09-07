import { act, render, screen } from '@testing-library/react'
import { useEffect, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { ToastProvider } from './toast.js'
import { DEFAULT_TOAST_DURATION_MS, useToast } from './use-toast.js'

const ToastCaller = ({
  message,
  persistent = false,
}: {
  readonly message: string
  readonly persistent?: boolean
}): ReactElement => {
  const toast = useToast()
  return (
    <button
      type="button"
      onClick={() => {
        toast.success(message, { persistent })
      }}
    >
      Показать тост
    </button>
  )
}

describe('Toast — автозакрытие (AC3, тест-план)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('закрывается ровно через 4000мс по умолчанию', () => {
    render(
      <ToastProvider>
        <ToastCaller message="Заказ оформлен" />
      </ToastProvider>,
    )

    act(() => {
      screen.getByRole('button', { name: 'Показать тост' }).click()
    })
    expect(screen.getByText('Заказ оформлен')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS - 1)
    })
    expect(screen.getByText('Заказ оформлен')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('Заказ оформлен')).not.toBeInTheDocument()
  })

  it('persistent-тост не закрывается через 10 секунд без действия (AC3)', () => {
    render(
      <ToastProvider>
        <ToastCaller message="Критично: заказ отменён" persistent />
      </ToastProvider>,
    )

    act(() => {
      screen.getByRole('button', { name: 'Показать тост' }).click()
    })

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(screen.getByText('Критично: заказ отменён')).toBeInTheDocument()
  })

  it('несколько тостов подряд не перекрывают друг друга — оба видны одновременно', () => {
    const TwoToasts = (): ReactElement => {
      const toast = useToast()
      return (
        <button
          type="button"
          onClick={() => {
            toast.success('Первый')
            toast.error('Второй')
          }}
        >
          Показать оба
        </button>
      )
    }

    render(
      <ToastProvider>
        <TwoToasts />
      </ToastProvider>,
    )

    act(() => {
      screen.getByRole('button', { name: 'Показать оба' }).click()
    })

    expect(screen.getByText('Первый')).toBeInTheDocument()
    expect(screen.getByText('Второй')).toBeInTheDocument()
  })
})

describe('Toast — варианты', () => {
  it.each(['success', 'error', 'info', 'warning'] as const)('рендерит вариант %s с иконкой', (variant) => {
    const VariantCaller = (): ReactElement => {
      const toast = useToast()
      return (
        <button
          type="button"
          onClick={() => {
            toast.show({ message: `Тост ${variant}`, variant })
          }}
        >
          Показать
        </button>
      )
    }

    render(
      <ToastProvider>
        <VariantCaller />
      </ToastProvider>,
    )

    act(() => {
      screen.getByRole('button', { name: 'Показать' }).click()
    })

    expect(screen.getByText(`Тост ${variant}`)).toBeInTheDocument()
    expect(document.querySelector(`.ui-toast--${variant}`)).toBeInTheDocument()
  })
})

describe('Toast — dismiss()', () => {
  it('закрывает тост по id до истечения таймера', () => {
    vi.useFakeTimers()

    const DismissDemo = (): ReactElement => {
      const toast = useToast()
      return (
        <button
          type="button"
          onClick={() => {
            const id = toast.info('Закроется вручную')
            toast.dismiss(id)
          }}
        >
          Показать и закрыть
        </button>
      )
    }

    render(
      <ToastProvider>
        <DismissDemo />
      </ToastProvider>,
    )

    act(() => {
      screen.getByRole('button', { name: 'Показать и закрыть' }).click()
    })

    expect(screen.queryByText('Закроется вручную')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})

describe('Toast — useToast() вне ToastProvider', () => {
  it('бросает понятную ошибку', () => {
    const Broken = (): null => {
      useToast()
      return null
    }

    expect(() => render(<Broken />)).toThrow('useToast() должен использоваться внутри <ToastProvider>')
  })
})

describe('Toast — доступность', () => {
  const AlwaysVisibleToasts = (): null => {
    const toast = useToast()
    useEffect(() => {
      toast.info('Информационный тост')
      toast.error('Критичный тост', { persistent: true })
      // Показ фиксированной пары тостов один раз при монтировании — `toast.*` стабильны между
      // рендерами (`useMemo`/`useCallback` в `use-toast.ts`), намеренно пустой массив зависимостей.
    }, [])
    return null
  }

  it('ноль critical/serious a11y-нарушений для обычного и persistent тоста', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <ToastProvider>
        <AlwaysVisibleToasts />
      </ToastProvider>,
    )

    expect(screen.getByText('Информационный тост')).toBeInTheDocument()
    expect(screen.getByText('Критичный тост')).toBeInTheDocument()
    expect(axeResults).toHaveNoViolations()
  })
})
