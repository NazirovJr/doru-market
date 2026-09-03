import type { ReactElement } from 'react'
import { CheckoutScreen } from '@/features/checkout/ui/checkout-screen'

/**
 * `checkout-page.tsx` (DTJ-235, «Что сделать» §9) — тонкая композиция `CheckoutScreen`, ноль
 * бизнес-логики (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §5: `pages/` — только композиция
 * `features`). Смонтирована на маршрут `/checkout` в `app/router.tsx` (lazy-чанк, тот же приём,
 * что `/cart`/`/map`/`/search`) — единственная точка входа: CTA «Перейти к оформлению»
 * (`features/cart/ui/cart-screen.tsx`, DTJ-234, уже сделан, `navigate('/checkout')`).
 */
const CheckoutPage = (): ReactElement => <CheckoutScreen />

export default CheckoutPage
