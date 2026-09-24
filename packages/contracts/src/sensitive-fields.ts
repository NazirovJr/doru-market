/**
 * Единый список чувствительных полей (EP-16, DTJ-375, SRS-ADM-044/063) — ЕДИНСТВЕННЫЙ источник
 * имён полей, подлежащих маскированию ГДЕ БЫ они ни встретились в приложении. Два независимых
 * потребителя читают ИМЕННО этот список, ни один не заводит свою копию (риск C15 AGENTS.md —
 * разработчик добавит новое чувствительное поле в один список и забудет про второй):
 *  - `apps/api/src/common/logging/pino-redaction.config.ts` — генерирует `pino` `redact.paths`;
 *  - `apps/api/src/common/audit/infrastructure/audit-log.repository.ts` — маскирует `metadata`
 *    перед `INSERT` в `audit_log` (второй, defense-in-depth рубеж после `AuditEntry.create()`,
 *    который отклоняет запись целиком при обнаружении запрещённого поля — см. JSDoc
 *    `apps/api/src/common/audit/domain/audit-entry.ts`).
 *
 * Список объединяет минимальный набор `DTJ-374` (`apiKey`/`hmacSecret`/`codeHash`/`password`) с
 * токенами сессии (`refreshToken`/`accessToken`, `DTJ-022`/`024`/`025`). `apiKey`/`hmacSecret` —
 * секреты API-ключей 1С (`DTJ-365`) — уже входили в минимальный набор `DTJ-374`, отдельного
 * добавления не требуют.
 */
export const SENSITIVE_FIELD_NAMES = [
  'apiKey',
  'hmacSecret',
  'codeHash',
  'password',
  'refreshToken',
  'accessToken',
] as const

const REDACTED_MARKER = '[REDACTED]'

/**
 * Глубоко маскирует поля из `SENSITIVE_FIELD_NAMES` — рекурсивно по объектам и массивам НА ЛЮБУЮ
 * глубину вложенности (`SRS-ADM-044`: «не полагаясь на то, что разработчик не забудет
 * залогировать» только верхний уровень). Совпадение — строго по ИМЕНИ ключа, без учёта регистра
 * не выполняется (поля в camelCase, единый стиль по всему проекту).
 *
 * Заменяет значение на строку-маркер `'[REDACTED]'`, НЕ удаляет ключ — форма объекта сохраняется
 * для отладки структуры. Чистая функция — не мутирует вход (C13), всегда возвращает новый объект.
 */
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
