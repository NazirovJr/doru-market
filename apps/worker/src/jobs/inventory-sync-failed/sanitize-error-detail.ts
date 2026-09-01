/**
 * Санитизация `error_detail` перед записью в `inventory_sync_errors`
 * (EP-05, DTJ-155, критерий 3).
 *
 * Защищает от утечки секретов в отчёт, видимый `pharmacy_admin`. Удаляет:
 *   - значения заголовков `X-Pharmacy-*` (api-key, signature и т.д.);
 *   - значения заголовка `Authorization`;
 *   - строки, похожие на JWT/bearer-токены (eyJ...);
 *   - UUID-v7 токенов из `Authorization: Bearer ...`.
 *
 * Используется ТОЛЬКО в worker — API-сторона защищает себя
 * `pino redact` (`apps/api/src/common/logging/root-logger.ts`), а здесь
 * лог-секретов нет, защищаем стек до того, как он попадёт в БД.
 */

/** Регекспы для санитизации — единый список, тестируется. */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  // X-Pharmacy-Api-Key: <token>
  /X-Pharmacy-[A-Za-z0-9-]+:\s*[^\s,;)}\]]+/gi,
  // X-Pharmacy-Signature: <token>
  /X-Pharmacy-Signature:\s*[A-Za-z0-9+/=]+/gi,
  // Authorization: Bearer <jwt>
  /Authorization:\s*Bearer\s+[A-Za-z0-9._\-]+/gi,
  // голые JWT (eyJ...)
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g,
  // refresh/access токены UUIDv7
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
]

/** Маска для замены — НЕ показываем само значение, ни длину, ни тип. */
const REDACTED = '<redacted>'

/**
 * Очистить `text` от чувствительных значений. Возвращает НОВУЮ строку
 * (входной `text` не мутирует).
 */
export function sanitizeErrorDetail(text: string): string {
  let result = text
  for (let i = 0; i < SENSITIVE_PATTERNS.length; i += 1) {
    const pattern = SENSITIVE_PATTERNS[i]!
    result = result.replace(pattern, REDACTED)
  }
  return result
}
