// Полнота словарей tj/ru/en для admin.users.* — тот же приём, что features/audit-log/i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { USER_ROLES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_USERS_KEYS: readonly string[] = [
  'admin.nav.users',
  'admin.users.title',
  'admin.users.loading',
  'admin.users.error',
  'admin.users.empty',
  'admin.users.load_more',
  'admin.users.filter.role',
  'admin.users.filter.role_all',
  'admin.users.filter.phone_number',
  'admin.users.filter.tenant_id',
  'admin.users.filter.apply',
  'admin.users.filter.reset',
  'admin.users.column.phone_number',
  'admin.users.column.role',
  'admin.users.column.tenant_id',
  'admin.users.column.status',
  'admin.users.column.actions',
  'admin.users.status.active',
  'admin.users.status.inactive',
  'admin.users.action.deactivate',
  'admin.users.action.change_role',
  'admin.users.action.grant_platform_role',
  'admin.users.deactivate.confirm_prompt',
  'admin.users.deactivate.confirm',
  'admin.users.change_role.select_label',
  'admin.users.change_role.submit',
  'admin.users.grant_platform_role.warning',
  'admin.users.grant_platform_role.select_label',
  'admin.users.grant_platform_role.reason_label',
  'admin.users.grant_platform_role.submit',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/users i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.users.*/admin.nav.users без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_USERS_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все 6 ролей (admin.users.role.*) переведены', (locale) => {
    const { t } = useT(locale)
    for (const role of USER_ROLES) {
      expect(t(`admin.users.role.${role}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
