/** SRS-API-065: `http://localhost:*` разрешён ТОЛЬКО при `NODE_ENV=development`. */
const LOCALHOST_DEV_ORIGIN_PATTERN = /^http:\/\/localhost:\d+$/

/** Минимальный срез `AppConfigService`, которого достаточно этой политике — держит функцию
 * тестируемой без построения полного сервиса и без зависимости от NestJS DI. */
export interface CorsOriginPolicyConfig {
  readonly isDevelopment: boolean
  readonly corsStaticOrigins: readonly string[]
}

/**
 * SRS-API-065: allowlist CORS = статический список из `CORS_STATIC_ORIGINS` +
 * (только в development) `http://localhost:*`. Динамический список `custom_domain`
 * активных White-Label тенантов из БД — вне этого тикета (`tenants` ещё не существует),
 * заводится вместе с EP-02/EP-18 как отдельная точка расширения этой функции.
 */
export function isAllowedCorsOrigin(origin: string, config: CorsOriginPolicyConfig): boolean {
  if (config.corsStaticOrigins.includes(origin)) {
    return true
  }
  return config.isDevelopment && LOCALHOST_DEV_ORIGIN_PATTERN.test(origin)
}
