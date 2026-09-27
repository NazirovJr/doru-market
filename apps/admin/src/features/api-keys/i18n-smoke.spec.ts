import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_API_KEYS_KEYS: readonly string[] = [
  'admin.nav.integration_keys',
  'admin.api_keys.title',
  'admin.api_keys.pharmacy_select_label',
  'admin.api_keys.action.create',
  'admin.api_keys.create.error',
  'admin.api_keys.loading',
  'admin.api_keys.error',
  'admin.api_keys.empty',
  'admin.api_keys.column.key_prefix',
  'admin.api_keys.column.status',
  'admin.api_keys.column.created_at',
  'admin.api_keys.column.actions',
  'admin.api_keys.column.mtls',
  'admin.api_keys.column.last_used_at',
  'admin.api_keys.action.rotate',
  'admin.api_keys.rotate.error',
  'admin.api_keys.status.active',
  'admin.api_keys.status.revoked',
  'admin.api_keys.action.revoke',
  'admin.api_keys.revoke.reason_label',
  'admin.api_keys.revoke.confirm',
  'admin.api_keys.revoke.error',
  'admin.api_keys.created_modal.title',
  'admin.api_keys.created_modal.warning',
  'admin.api_keys.created_modal.api_key_label',
  'admin.api_keys.created_modal.hmac_secret_label',
  'admin.api_keys.created_modal.copy',
  'admin.api_keys.created_modal.copied',
  'admin.api_keys.created_modal.confirm_close',
  'common.close',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/api-keys i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.api_keys.*/admin.nav.integration_keys без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_API_KEYS_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
