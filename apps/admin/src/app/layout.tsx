import { type ReactElement } from 'react'
import { useLocation, useNavigate, Outlet } from 'react-router'
import { useT } from '@dorutj/i18n'
import { Button, LanguageSwitcher, Tabs, TenantBrandLogo, type TabItem } from '@dorutj/ui'
import type { UserRole } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/auth/auth-store'
import { getRoutesForRole, type RouteConfig } from '@/app/role-routes'

// packages/ui пока не даёт sidebar-компонента — та же навигация Tabs, что apps/pharmacy/src/app/layout.tsx.
function resolveActiveId(roleRoutes: readonly RouteConfig[], pathname: string): string {
  const sorted = [...roleRoutes].sort((a, b) => b.path.length - a.path.length)
  const match = sorted.find((item) => pathname === `/admin/${item.path}` || pathname.startsWith(`/admin/${item.path}/`))
  return match?.path ?? (roleRoutes[0]?.path ?? '')
}

export const AppLayout = (): ReactElement => {
  const { locale, setLocale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const clearSession = useAuthStore((state) => state.clear)

  const roleRoutes = getRoutesForRole((user?.role ?? null) as UserRole | null)
  const tabs: TabItem[] = roleRoutes.map((item) => ({ id: item.path, label: t(item.titleKey) }))
  const activeId = resolveActiveId(roleRoutes, location.pathname)

  function handleTabChange(id: string): void {
    void navigate(`/admin/${id}`)
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
            <TenantBrandLogo fallbackName={t('brand.name')} size={32} />
            <span className="text-sm text-ink-muted" data-testid="shell-staff-label">
              {user?.fullName ?? t('admin.shell.staff_fallback')}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSwitcher currentLocale={locale} onChange={setLocale} aria-label={t('admin.shell.language_switcher_aria_label')} />
            <Button type="button" variant="ghost" onClick={handleLogout} data-testid="shell-logout-button">
              {t('admin.shell.logout')}
            </Button>
          </div>
        </div>
        {tabs.length > 0 ? (
          <Tabs tabs={tabs} activeId={activeId} onChange={handleTabChange} aria-label={t('admin.shell.nav_aria_label')} />
        ) : null}
      </header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  )
}
