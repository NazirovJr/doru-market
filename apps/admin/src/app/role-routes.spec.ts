import { describe, expect, it } from 'vitest'
import { getRoutesForRole } from './role-routes'

const SUPER_ADMIN_PATHS = ['tenants', 'feature-flags', 'audit-log', 'undelivered-notifications', 'pharmacies', 'users', 'orders', 'finance', 'settings']
const PHARMACY_ADMIN_PATHS = ['my-pharmacies', 'my-orders', 'staff', 'integration-keys', 'reports', 'schedule']

describe('getRoutesForRole', () => {
  it('super_admin получает все 9 разделов админ-панели', () => {
    const routes = getRoutesForRole('super_admin')
    expect(routes.map((r) => r.path)).toEqual(SUPER_ADMIN_PATHS)
  })

  it('pharmacy_admin получает все 6 разделов кабинета аптеки', () => {
    const routes = getRoutesForRole('pharmacy_admin')
    expect(routes.map((r) => r.path)).toEqual(PHARMACY_ADMIN_PATHS)
  })

  it.each(['customer', 'pharmacist', 'courier', 'support_agent'] as const)(
    'роль %s получает ПУСТОЙ список маршрутов /admin/*',
    (role) => {
      expect(getRoutesForRole(role)).toEqual([])
    },
  )

  it('null (нет сессии) получает пустой список', () => {
    expect(getRoutesForRole(null)).toEqual([])
  })

  it('ни один путь super_admin не совпадает с путём pharmacy_admin (нет коллизий в общем /admin/*)', () => {
    const overlap = SUPER_ADMIN_PATHS.filter((p) => (PHARMACY_ADMIN_PATHS as readonly string[]).includes(p))
    expect(overlap).toEqual([])
  })

  it('каждый маршрут имеет непустой titleKey (i18n, не хардкод)', () => {
    const allRoutes = [...getRoutesForRole('super_admin'), ...getRoutesForRole('pharmacy_admin')]
    for (const route of allRoutes) {
      expect(route.titleKey).toMatch(/^admin\.nav\./)
    }
  })
})
