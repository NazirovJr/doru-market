// Полнота словарей tj/ru/en для admin.audit_log.* — тот же приём, что features/support/i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { AUDIT_LOG_CATEGORY_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_AUDIT_LOG_KEYS: readonly string[] = [
  'admin.nav.audit_log',
  'admin.audit_log.title',
  'admin.audit_log.loading',
  'admin.audit_log.error',
  'admin.audit_log.empty',
  'admin.audit_log.load_more',
  'admin.audit_log.system_actor',
  'admin.audit_log.column.created_at',
  'admin.audit_log.column.category',
  'admin.audit_log.column.entity',
  'admin.audit_log.column.actor',
  'admin.audit_log.column.action',
  'admin.audit_log.column.reason',
  'admin.audit_log.filter.category',
  'admin.audit_log.filter.category_all',
  'admin.audit_log.filter.entity_id',
  'admin.audit_log.filter.created_at_from',
  'admin.audit_log.filter.created_at_to',
  'admin.audit_log.filter.apply',
  'admin.audit_log.filter.reset',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/audit-log i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.audit_log.*/admin.nav.audit_log без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_AUDIT_LOG_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все 8 категорий (admin.audit_log.category.*) переведены', (locale) => {
    const { t } = useT(locale)
    for (const category of AUDIT_LOG_CATEGORY_VALUES) {
      expect(t(`admin.audit_log.category.${category}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
