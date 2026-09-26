// Полнота словарей tj/ru/en для admin.staff.* — тот же приём, что features/users/i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { STAFF_ACCOUNT_ROLE_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_STAFF_KEYS: readonly string[] = [
  'admin.nav.staff',
  'admin.staff.title',
  'admin.staff.loading',
  'admin.staff.error',
  'admin.staff.empty',
  'admin.staff.load_more',
  'admin.staff.column.full_name',
  'admin.staff.column.phone_number',
  'admin.staff.column.role',
  'admin.staff.column.pharmacy',
  'admin.staff.column.status',
  'admin.staff.column.actions',
  'admin.staff.status.active',
  'admin.staff.status.inactive',
  'admin.staff.action.deactivate',
  'admin.staff.action.retry_provision_courier',
  'admin.staff.deactivate.confirm_prompt',
  'admin.staff.deactivate.confirm',
  'admin.staff.create.phone_label',
  'admin.staff.create.full_name_label',
  'admin.staff.create.role_label',
  'admin.staff.create.pharmacy_label',
  'admin.staff.create.submit',
  'admin.staff.create.error',
  'admin.staff.create.partial_error',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/staff i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.staff.*/admin.nav.staff без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_STAFF_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — обе staff-роли (admin.staff.role.*) переведены', (locale) => {
    const { t } = useT(locale)
    for (const role of STAFF_ACCOUNT_ROLE_VALUES) {
      expect(t(`admin.staff.role.${role}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
