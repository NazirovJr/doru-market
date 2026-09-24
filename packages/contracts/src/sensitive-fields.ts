/** Единственный список: его читают и pino-редактор, и маскирование audit_log. */
export const SENSITIVE_FIELD_NAMES = [
  'apiKey',
  'hmacSecret',
  'codeHash',
  'password',
  'refreshToken',
  'accessToken',
] as const

const REDACTED_MARKER = '[REDACTED]'

/** Рекурсивно на любую глубину; значение заменяется маркером, ключ сохраняется. */
export function maskSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  return maskValue(obj) as Record<string, unknown>
}

function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskValue)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const masked: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    masked[key] = isSensitiveFieldName(key) ? REDACTED_MARKER : maskValue(nested)
  }
  return masked
}

function isSensitiveFieldName(key: string): boolean {
  return (SENSITIVE_FIELD_NAMES as readonly string[]).includes(key)
}
