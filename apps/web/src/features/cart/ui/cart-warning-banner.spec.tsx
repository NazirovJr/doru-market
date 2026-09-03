import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { CartWarningBanner } from './cart-warning-banner'
import type { CartWarning } from '../model/group-warnings'

/**
 * `cart-warning-banner.spec.tsx` (DTJ-234, AC2, тест-план «рендер предупреждений по типу»).
 * `t` — `useT('ru')` вызван напрямую (чистая функция без React-состояния, см. JSDoc
 * `packages/i18n/src/use-t.ts`) — компонент принимает `t` явным пропом, локаль детерминирована.
 */

const { t } = useT('ru')

describe('CartWarningBanner (DTJ-234)', () => {
  it('1. пустой массив — ничего не рендерит', () => {
    const { container } = render(<CartWarningBanner warnings={[]} t={t} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('2. [AC2] duplicate_substance — виден красный баннер (role=alert) с каноническим текстом packages/i18n', () => {
    const warnings: CartWarning[] = [
      {
        type: 'duplicate_substance',
        existingMedicineId: 'med-a',
        existingMedicineTradeName: 'Медикамент А',
        newMedicineId: 'med-b',
        newMedicineTradeName: 'Медикамент Б',
        substanceNames: ['Ибупрофен'],
      },
    ]
    render(<CartWarningBanner warnings={warnings} t={t} />)
    const banner = screen.getByTestId('cart-warning-duplicate-substance')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent('В корзине уже есть препарат с тем же действующим веществом')
    expect(banner).toHaveTextContent('Проверьте дозировку перед заказом')
    // DTJ-234 (дефект приёмки): текст несёт РЕАЛЬНОЕ название вещества, не id.
    expect(banner).toHaveTextContent('Ибупрофен')
    expect(banner).not.toHaveTextContent('med-a')
    expect(banner).not.toHaveTextContent('med-b')
    // Дизайн-референс текст ("X есть в нескольких препаратах корзины — риск превышения дозы")
    // НЕ используется дословно — тикет требует канонический ux.* текст, не кальку дизайна.
    expect(banner).not.toHaveTextContent('риск превышения дозы')
  })

  it('3. insufficient_stock — рендерится менее критичным стилем (role=status, не alert)', () => {
    const warnings: CartWarning[] = [
      { cartItemId: 'item-1', type: 'insufficient_stock', availableQuantity: 2 },
    ]
    render(<CartWarningBanner warnings={warnings} t={t} />)
    const banner = screen.getByTestId('cart-warning-insufficient-stock')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveTextContent('2')
  })

  it('4. смешанный массив — рендерит оба баннера одновременно', () => {
    const warnings: CartWarning[] = [
      { cartItemId: 'item-1', type: 'insufficient_stock', availableQuantity: 1 },
      {
        type: 'duplicate_substance',
        existingMedicineId: 'med-a',
        existingMedicineTradeName: 'Медикамент А',
        newMedicineId: 'med-b',
        newMedicineTradeName: 'Медикамент Б',
        substanceNames: ['Ибупрофен'],
      },
    ]
    render(<CartWarningBanner warnings={warnings} t={t} />)
    expect(screen.getByTestId('cart-warning-duplicate-substance')).toBeInTheDocument()
    expect(screen.getByTestId('cart-warning-insufficient-stock')).toBeInTheDocument()
  })
})
