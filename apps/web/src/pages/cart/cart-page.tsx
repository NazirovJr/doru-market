import type { ReactElement } from 'react'
import { CartScreen } from '@/features/cart/ui/cart-screen'

/**
 * `cart-page.tsx` (DTJ-234, «Что сделать» §7) — тонкая композиция `CartScreen`, ноль бизнес-логики
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §5: `pages/` — только композиция `features`). Смонтирована
 * на маршрут `/cart` в `app/router.tsx` (lazy-чанк, тот же приём, что `/map`/`/search`).
 */
const CartPage = (): ReactElement => <CartScreen />

export default CartPage
