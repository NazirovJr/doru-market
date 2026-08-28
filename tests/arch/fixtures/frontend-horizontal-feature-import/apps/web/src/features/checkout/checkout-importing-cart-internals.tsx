// Нарушение §5: горизонтальный импорт checkout -> cart в обход публичного API фичи.
import { cartInternalTotal } from '../cart/model/internal-helper'

export const describeCheckoutTotal = (items: number): number => cartInternalTotal(items)
