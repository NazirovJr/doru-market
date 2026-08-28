const UNKNOWN_HEALTH_CHECK_ERROR_MESSAGE = 'unknown error'

/** Достаёт человекочитаемое сообщение из ошибки readiness-проверки для тела `503`-ответа. */
export function toReadableMessage(error: unknown): string {
  return error instanceof Error ? error.message : UNKNOWN_HEALTH_CHECK_ERROR_MESSAGE
}
