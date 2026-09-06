/**
 * Smoke-тест локализации (DTJ-283, тест-план: «Smoke-тест рендера всех 3 локалей без падения/
 * непереведённых ключей»). `apps/admin` не имеет переключателя локали (`ADMIN_LOCALE` фиксирован
 * `'ru'`, см. её JSDoc) — проверяет ПОЛНОТУ словарей напрямую через `useT(locale)`, не рендер UI.
 */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { SUPPORT_TICKET_CATEGORY_VALUES, SUPPORT_TICKET_STATUS_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_SUPPORT_KEYS: readonly string[] = [
  'admin.support.queue.title',
  'admin.support.queue.loading',
  'admin.support.queue.error',
  'admin.support.queue.empty',
  'admin.support.filters.status',
  'admin.support.filters.category',
  'admin.support.filters.all',
  'admin.support.filters.only_overdue',
  'admin.support.status_action.in_progress',
  'admin.support.status_action.resolved',
  'admin.support.status_action.closed',
  'admin.support.sla.ok',
  'admin.support.sla.warning',
  'admin.support.sla.overdue',
  'admin.support.sla.responded',
  'admin.support.detail.title',
  'admin.support.detail.loading',
  'admin.support.detail.error',
  'admin.support.detail.category',
  'admin.support.detail.channel',
  'admin.support.detail.status',
  'admin.support.detail.order',
  'admin.support.detail.description',
  'admin.support.detail.reply_label',
  'admin.support.detail.reply_submit',
  'admin.support.detail.reply_error',
  'admin.support.author_role.customer',
  'admin.support.author_role.support_agent',
  'admin.support.author_role.super_admin',
  'admin.support.author_role.pharmacist',
  'admin.support.author_role.pharmacy_admin',
  'admin.support.author_role.courier',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/support i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.support.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_SUPPORT_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все 6 категорий (support.category.*) переведены', (locale) => {
    const { t } = useT(locale)
    for (const category of SUPPORT_TICKET_CATEGORY_VALUES) {
      expect(t(`support.category.${category}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все 4 статуса (support.status.*) переведены', (locale) => {
    const { t } = useT(locale)
    for (const status of SUPPORT_TICKET_STATUS_VALUES) {
      expect(t(`support.status.${status}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
