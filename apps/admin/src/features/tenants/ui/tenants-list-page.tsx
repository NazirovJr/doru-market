/**
 * `TenantsListPage` (EP-15, DTJ-351) — экран `/admin/tenants` (`super_admin`, критерий приёмки 1:
 * ВСЕ тенанты платформы, нейтральный + White-Label, без фильтра по своему тенанту — сервер уже
 * не скоупит `GET /tenants` по тенанту вызывающего, здесь просто рендерится то, что вернул API).
 *
 * Таблица `packages/ui` не используется (`CursorTable`) — `packages/ui/src/index.ts` пуст (тот
 * же уже задокументированный факт, что `feature-flags-page.tsx`/`role-routes.ts`) — native
 * `<table>`, заменяется одной правкой, когда компонент появится. "Load more" — по `nextCursor`
 * пагинация вне скоупа R1-экрана (тот же class упрощения, что `use-support-tickets.ts`
 * `LIST_LIMIT=100` без "load more") — тикет не описывает постраничную навигацию в UI.
 */
import { type ReactElement } from 'react'
import { Link } from 'react-router'
import { useT } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useTenantsList } from '../api/use-tenants'

export const TenantsListPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const query = useTenantsList()

  return (
    <section data-testid="tenants-list-page">
      <h1>{t('admin.tenants.title')}</h1>
      {query.isLoading ? <p role="status">{t('admin.tenants.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.tenants.error')}</p> : null}
      <table>
        <thead>
          <tr>
            <th>{t('admin.tenants.column.brand_name')}</th>
            <th>{t('admin.tenants.column.slug')}</th>
            <th>{t('admin.tenants.column.domain')}</th>
            <th>{t('admin.tenants.column.created_at')}</th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((tenant) => (
            <tr key={tenant.id} data-testid="tenant-row">
              <td>
                <Link to={`/admin/tenants/${tenant.id}`}>{tenant.brandName}</Link>
              </td>
              <td>{tenant.slug}</td>
              <td>{tenant.customDomain ?? '—'}</td>
              <td>{new Date(tenant.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
