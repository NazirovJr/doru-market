/**
 * Канонические HTTP-статусы (DTJ-018, DTJ-029).
 *
 * Используется enum (а не отдельные `const`) — `ignoreEnums: true`
 * в eslint.config.mjs легитимно исключает числовые литералы членов enum'а
 * из правила `no-magic-numbers` (C6).
 */
export const enum HttpStatus {
  /** `400 Bad Request` — клиент прислал невалидный запрос (валидация, синтаксис). */
  BadRequest = 400,
  /** `401 Unauthorized` — отсутствует/невалидна аутентификация. */
  Unauthorized = 401,
  /** `403 Forbidden` — аутентификация есть, но прав нет. */
  Forbidden = 403,
  /** `404 Not Found` — ресурс не найден. */
  NotFound = 404,
  /** `408 Request Timeout` — клиент не уложился в ожидание. */
  RequestTimeout = 408,
  /** `409 Conflict` — конфликт состояния (идемпотентность, дубликат). */
  Conflict = 409,
  /** `422 Unprocessable Entity` — бизнес-правило нарушено. */
  UnprocessableEntity = 422,
  /** `423 Locked` — OTP-канал заблокирован (lockout после брутфорса). */
  Locked = 423,
  /** `429 Too Many Requests` — превышен rate limit. */
  TooManyRequests = 429,
  /** `500 Internal Server Error` — неожиданное исключение, fallback. */
  InternalServerError = 500,
  /** `200 OK` — успешный идемпотентный повтор. */
  Ok = 200,
  /** `201 Created` — успешное создание ресурса (POST). */
  Created = 201,
}

/** Алиасы для обратной совместимости с кодом, использующим `HTTP_STATUS_*`. */
export const HTTP_STATUS_BAD_REQUEST: number = HttpStatus.BadRequest
export const HTTP_STATUS_UNAUTHORIZED: number = HttpStatus.Unauthorized
export const HTTP_STATUS_FORBIDDEN: number = HttpStatus.Forbidden
export const HTTP_STATUS_NOT_FOUND: number = HttpStatus.NotFound
export const HTTP_STATUS_REQUEST_TIMEOUT: number = HttpStatus.RequestTimeout
export const HTTP_STATUS_CONFLICT: number = HttpStatus.Conflict
export const HTTP_STATUS_UNPROCESSABLE_ENTITY: number = HttpStatus.UnprocessableEntity
export const HTTP_STATUS_LOCKED: number = HttpStatus.Locked
export const HTTP_STATUS_TOO_MANY_REQUESTS: number = HttpStatus.TooManyRequests
export const HTTP_STATUS_INTERNAL_SERVER_ERROR: number = HttpStatus.InternalServerError
export const HTTP_STATUS_OK: number = HttpStatus.Ok
export const HTTP_STATUS_CREATED: number = HttpStatus.Created