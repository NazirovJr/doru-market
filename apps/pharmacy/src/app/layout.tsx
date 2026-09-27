import { type ReactElement } from 'react'
import { useLocation, useNavigate, Outlet } from 'react-router'
import type { UserRole } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { BrandLogo, Button, LanguageSwitcher, Tabs, type TabItem } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'

// Роли per-раздела сверены с @Roles(...) реальных контроллеров apps/api, не угаданы.
interface NavItem {
  readonly id: string
  readonly path: string
  readonly labelKey: string
  readonly roles: readonly UserRole[]
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'order-queue', path: '/', labelKey: 'pharmacy.shell.nav.order_queue', roles: ['pharmacist', 'pharmacy_admin'] },
  { id: 'inventory', path: '/inventory', labelKey: 'pharmacy.shell.nav.inventory', roles: ['pharmacist', 'pharmacy_admin'] },
  {
    id: 'sync-history',
    path: '/inventory/sync-history',
    labelKey: 'pharmacy.shell.nav.sync_history',
    roles: ['pharmacist', 'pharmacy_admin', 'super_admin'],
  },
  {
    id: 'returns',
    path: '/pharmacy/returns',
    labelKey: 'pharmacy.shell.nav.returns',
    roles: ['pharmacist', 'pharmacy_admin', 'super_admin'],
  },
]

const DEFAULT_TAB_ID = NAV_ITEMS[0]?.id ?? 'order-queue'

function resolveActiveTabId(pathname: string): string {
  // Самый длинный совпадающий `path` первым (иначе `/inventory` перекрывает `/inventory/sync-history`).
  const sorted = [...NAV_ITEMS].sort((a, b) => b.path.length - a.path.length)
  return sorted.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))?.id ?? DEFAULT_TAB_ID
}

export const AppLayout = (): ReactElement => {
  const { locale, setLocale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const clearSession = useAuthStore((state) => state.clear)

  const visibleItems = NAV_ITEMS.filter((item) => user === null || (item.roles as readonly string[]).includes(user.role))
  const tabs: TabItem[] = visibleItems.map((item) => ({ id: item.id, label: t(item.labelKey) }))
  const activeId = resolveActiveTabId(location.pathname)

  function handleTabChange(id: string): void {
    const target = visibleItems.find((item) => item.id === id)
    if (target !== undefined) {
      void navigate(target.path)
    }
  }

  function handleLogout(): void {
    clearSession()
    void navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="flex flex-col gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrandLogo altText={t('brand.name')} size={32} />
            <span className="text-sm text-ink-muted" data-testid="shell-staff-label">
              {user?.fullName ?? t('pharmacy.shell.staff_fallback')}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSwitcher
              currentLocale={locale}
              onChange={setLocale}
              aria-label={t('pharmacy.shell.language_switcher_aria_label')}
            />
            <Button type="button" variant="ghost" onClick={handleLogout} data-testid="shell-logout-button">
              {t('pharmacy.shell.logout')}
            </Button>
          </div>
        </div>
        {tabs.length > 0 ? (
          <Tabs
            tabs={tabs}
            activeId={activeId}
            onChange={handleTabChange}
            aria-label={t('pharmacy.shell.nav_aria_label')}
          />
        ) : null}
      </header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  )
}
