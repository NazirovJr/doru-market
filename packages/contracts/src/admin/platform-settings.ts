// descriptionKey, не description: описание — UI-текст, идёт через i18n, не хардкод бэкенда.
export interface PlatformSettingDto {
  readonly key: string
  readonly currentValue: string
  readonly descriptionKey: string
  readonly requiresRedeploy: true
}

// Единственное место перечисления ключей — whitelist, не blacklist: секретные ENV сюда не входят.
export const PLATFORM_SETTINGS_KEY_NAMES = [
  'RATE_LIMIT_ANON_PER_MIN',
  'RATE_LIMIT_USER_PER_MIN',
  'RATE_LIMIT_1C_BATCH_PER_MIN',
  'PAYMENT_PROVIDER_TIMEOUT_MS',
  'REQUEST_TIMEOUT_MS',
  'OTP_REQUEST_COOLDOWN_SECONDS',
  'OTP_REQUEST_MAX_PER_10MIN',
  'OTP_REQUEST_MAX_PER_DAY',
  'OTP_REQUEST_MAX_PER_IP_PER_HOUR',
  'OTP_VERIFY_MAX_ATTEMPTS',
  'SEARCH_QUERY_TIMEOUT_MS',
  'CART_HOLD_TTL_SECONDS',
  'EXCEL_IMPORT_MAX_ROWS',
  'BANK_INVOICE_VALIDITY_MINUTES',
  'API_KEY_ROTATION_GRACE_PERIOD_HOURS',
] as const

export type PlatformSettingKeyName = (typeof PLATFORM_SETTINGS_KEY_NAMES)[number]

const DESCRIPTION_KEY_PREFIX = 'admin.platform_settings.key.'

export function platformSettingDescriptionKey(name: PlatformSettingKeyName): string {
  return `${DESCRIPTION_KEY_PREFIX}${name.toLowerCase()}`
}
