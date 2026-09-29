import type { ReactElement } from 'react'
import { Link } from 'react-router'
import { Badge } from '@dorutj/ui'
import { useT } from '@dorutj/i18n'
import { useAuthStore } from '@/shared/api/auth-store'
import { useLocale } from '@/shared/config/locale-provider'
import { useCart } from '../api/use-cart'
import { useCartSessionStore } from '../model/cart-session-store'

const ICON_SIZE_PX = 24

const CartIcon = (): ReactElement => (
  <svg aria-hidden="true" width={ICON_SIZE_PX} height={ICON_SIZE_PX} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="20" r="1.5" />
    <circle cx="18" cy="20" r="1.5" />
    <path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20.5 8H6" />
  </svg>
)

export const CartHeaderLink = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const isAuthenticated = useAuthStore((state) => state.accessToken !== null)
  const hasGuestSession = useCartSessionStore((state) => state.sessionToken !== null)
  const cart = useCart({ enabled: isAuthenticated || hasGuestSession })
  const count = cart.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0

  return (
    <Link
      to="/cart"
      aria-label={t('cart.open_label')}
      data-testid="header-cart-link"
      className="inline-flex min-h-12 min-w-12 items-center justify-center gap-1 text-ink"
    >
      <CartIcon />
      {count > 0 ? (
        <span data-testid="header-cart-count">
          <Badge tone="neutral">{String(count)}</Badge>
        </span>
      ) : null}
    </Link>
  )
}
