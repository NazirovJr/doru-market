// ENV читается только через AppConfigService (C6), не process.env/ConfigService напрямую.
import { Inject, Injectable } from '@nestjs/common'
import { PLATFORM_SETTINGS_KEY_NAMES, platformSettingDescriptionKey, type PlatformSettingDto, type PlatformSettingKeyName } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'

// Значения — имена геттеров, не сами функции: SCREAMING_SNAKE_CASE ключ + функция-значение ловит naming-convention lint.
const GETTER_NAMES: Readonly<Record<PlatformSettingKeyName, keyof AppConfigService>> = {
  RATE_LIMIT_ANON_PER_MIN: 'rateLimitAnonPerMin',
  RATE_LIMIT_USER_PER_MIN: 'rateLimitUserPerMin',
  RATE_LIMIT_1C_BATCH_PER_MIN: 'rateLimit1cBatchPerMin',
  PAYMENT_PROVIDER_TIMEOUT_MS: 'paymentProviderTimeoutMs',
  REQUEST_TIMEOUT_MS: 'requestTimeoutMs',
  OTP_REQUEST_COOLDOWN_SECONDS: 'otpRequestCooldownSeconds',
  OTP_REQUEST_MAX_PER_10MIN: 'otpRequestMaxPer10Min',
  OTP_REQUEST_MAX_PER_DAY: 'otpRequestMaxPerDay',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: 'otpRequestMaxPerIpPerHour',
  OTP_VERIFY_MAX_ATTEMPTS: 'otpVerifyMaxAttempts',
  SEARCH_QUERY_TIMEOUT_MS: 'searchQueryTimeoutMs',
  CART_HOLD_TTL_SECONDS: 'cartHoldTtlSeconds',
  EXCEL_IMPORT_MAX_ROWS: 'excelImportMaxRows',
  BANK_INVOICE_VALIDITY_MINUTES: 'bankInvoiceValidityMinutes',
  API_KEY_ROTATION_GRACE_PERIOD_HOURS: 'apiKeyRotationGracePeriodHours',
}

@Injectable()
export class GetPlatformSettingsUseCase {
  public constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  public execute(): readonly PlatformSettingDto[] {
    return PLATFORM_SETTINGS_KEY_NAMES.map((key) => ({
      key,
      currentValue: String(this.config[GETTER_NAMES[key]]),
      descriptionKey: platformSettingDescriptionKey(key),
      requiresRedeploy: true,
    }))
  }
}
