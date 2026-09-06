/**
 * `ForbiddenPage` (DTJ-350, EP-15) — критерий приёмки 3: прямой переход по URL чужого ролевого
 * раздела (напр. `pharmacy_admin` на `/admin/tenants`) не должен давать пустой экран. Маршрут
 * для чужой роли физически НЕ СМОНТИРОВАН (`role-routes.ts` фильтрует по роли ДО построения
 * дерева) — эта страница рендерится через catch-all `admin/*` в `router.tsx`, когда ни один
 * более специфичный маршрут не совпал.
 *
 * НЕ замена серверной авторизации — реальная защита остаётся на `@Roles(...)` гвардах API
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1). Эта страница — только UX для случая, когда клиент
 * уже знает (по декодированной роли), что раздел не его.
 */
import { type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'

const DEFAULT_LOCALE = 'tj' as const

export const ForbiddenPage = (): ReactElement => {
  const { t } = useT(DEFAULT_LOCALE)
  return (
    <section data-testid="admin-forbidden">
      <h2>{t('admin.forbidden.title')}</h2>
      <p>{t('admin.forbidden.message')}</p>
    </section>
  )
}
