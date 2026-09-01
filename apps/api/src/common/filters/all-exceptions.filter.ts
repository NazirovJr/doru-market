/**
 * `AllExceptionsFilter` (EP-01, DTJ-018 + DTJ-029) — глобальный exception filter.
 *
 * Единая точка маппинга `DomainError` → HTTP `ErrorEnvelope` (`{ error: { code,
 * message, details } }`). Каждый контроллер может спокойно `throw result.error` —
 * фильтр перехватывает и формирует ответ.
 *
 * Источник истины для маппинга `ErrorCode → HTTP-статус` — `ERROR_HTTP_STATUS`
 * из `@dorutj/contracts` (DTJ-005). `Record<ErrorCode, number>` гарантирует
 * компилятором, что статус указан для КАЖДОГО кода.
 *
 * Не-`DomainError` исключения (`TypeError`, `Error` от плохого use case'а)
 * маппятся в `500 INTERNAL_ERROR` с каноническим `t('ux.error.generic_500')`
 * НЕ показывается (на client — `INTERNAL_ERROR` без details, чтобы не
 * утекали stack traces). `pino.fatal` логирует полный stack для ops.
 *
 * Регистрация:
 *   `app.useGlobalFilters(new AllExceptionsFilter(pinoLogger))` в main.ts
 *   (DTJ-001) — НЕ через APP_FILTER provider, т.к. фильтр зависит от
 *   PINO_LOGGER (resolved из `LoggerModule`, DTJ-001).
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import { ERROR_HTTP_STATUS, ErrorCode, type ErrorEnvelope } from '@dorutj/contracts'
import { DomainError } from '@dorutj/contracts'
import { type FastifyReply } from 'fastify'

const FALLBACK_HTTP_STATUS = 500

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()

    if (exception instanceof DomainError) {
      const status = ERROR_HTTP_STATUS[exception.code] ?? FALLBACK_HTTP_STATUS
      const envelope: ErrorEnvelope = {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details !== undefined ? { details: exception.details } : {}),
        },
      }
      reply.status(status).send(envelope)
      return
    }

    if (exception instanceof HttpException) {
      this.sendHttpException(exception, reply)
      return
    }

    // Неожиданное исключение — НЕ раскрываем stack в HTTP, логируем подробно.
    this.logger.error(
      `Неожиданное исключение в request handler: ${exception instanceof Error ? exception.stack : String(exception)}`,
    )
    const envelope: ErrorEnvelope = {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
      },
    }
    reply.status(FALLBACK_HTTP_STATUS).send(envelope)
  }

  /**
   * Нативные NestJS-исключения (`BadRequestException` от Zod pipe, `Unauthorized`/
   * `ForbiddenException` от гвардов и т.п.) — пробрасываем тело как есть, оборачивая
   * в `ErrorEnvelope`.
   *
   * Гварды (`AuthGuard`/`RolesGuard`) бросают `UnauthorizedException`/
   * `ForbiddenException` с явным `{ code, message }` телом (см. их JSDoc:
   * `TOKEN_EXPIRED`/`TOKEN_INVALID`/`CROSS_TENANT_ACCESS_DENIED`/`INSUFFICIENT_ROLE`/...).
   * Без ветки `extractErrorCode` ниже `code` ВСЕГДА схлопывался до общего
   * `UNAUTHENTICATED`/`FORBIDDEN` по одному лишь HTTP-статусу (`mapHttpStatusToCode`),
   * а клиент терял возможность различить причину (обнаружено интеграционными
   * тестами auth — они били по конкретным кодам, а получали только generic).
   * Статус берём ИЗ `ERROR_HTTP_STATUS` (источник истины, DTJ-005), а не из
   * `exception.getStatus()` — гварды не всегда бросают класс-исключение с верным
   * HTTP-статусом для кода (например, `CROSS_TENANT_ACCESS_DENIED` — канонически
   * 403, но кидается через `UnauthorizedException`, у которой `getStatus() === 401`).
   */
  private sendHttpException(exception: HttpException, reply: FastifyReply): void {
    const status = exception.getStatus()
    const body = exception.getResponse()
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body).message)
        : exception.message
    const explicitCode = extractErrorCode(body)
    if (explicitCode !== null) {
      const canonicalStatus = ERROR_HTTP_STATUS[explicitCode]
      const envelope: ErrorEnvelope = { error: { code: explicitCode, message } }
      reply.status(canonicalStatus).send(envelope)
      return
    }
    const envelope: ErrorEnvelope = {
      error: { code: mapHttpStatusToCode(status), message },
    }
    reply.status(status).send(envelope)
  }
}

/**
 * Достаёт `code` из тела исключения, ЕСЛИ это распознанный `ErrorCode` (есть
 * запись в `ERROR_HTTP_STATUS`). Отсекает тела нативных Nest-исключений без
 * доменного кода (`{ statusCode, message, error }` от `BadRequestException`
 * Zod-pipe'а и т.п.) — для них `code` ниже вычисляется из HTTP-статуса.
 */
function extractErrorCode(body: unknown): ErrorCode | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return null
  }
  const candidate = (body as { readonly code: unknown }).code
  return typeof candidate === 'string' && candidate in ERROR_HTTP_STATUS ? (candidate as ErrorCode) : null
}

function mapHttpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION_ERROR
    case 401:
      return ErrorCode.UNAUTHENTICATED
    case 403:
      return ErrorCode.FORBIDDEN
    case 404:
      return ErrorCode.NOT_FOUND
    case 409:
      return ErrorCode.CONFLICT
    case 423:
      return ErrorCode.OTP_LOCKED
    case 429:
      return ErrorCode.RATE_LIMITED
    default:
      return ErrorCode.INTERNAL_ERROR
  }
}
