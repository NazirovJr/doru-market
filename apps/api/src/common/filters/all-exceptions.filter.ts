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
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_CONFLICT,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_LOCKED,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
} from '../http/http-status.constants.js'

const FALLBACK_HTTP_STATUS = HTTP_STATUS_INTERNAL_SERVER_ERROR

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()

    if (exception instanceof DomainError) {
      const status = resolveHttpStatus(exception.code)
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
      `Неожиданное исключение в request handler: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
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
    // `getResponse()` типизирован как `string | object`, но исключение сюда приходит из
    // произвольного места приложения — типизирован намеренно как `unknown`, чтобы не
    // терять runtime-проверку `body !== null` (защита от `HttpException`, созданных в обход
    // штатного конструктора, напр. сторонним кодом через `as any`).
    const body: unknown = exception.getResponse()
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
 * `ERROR_HTTP_STATUS: Record<ErrorCode, number>` гарантирует статус для КАЖДОГО валидного
 * `ErrorCode` — но `exception.code` в рантайме не обязан быть валидным `ErrorCode`: `DomainError`
 * лишь ОБЪЯВЛЯЕТ поле `code: ErrorCode`, а реальное значение может прийти в обход компилятора
 * (легаси-код, `as ErrorCode`) — см. `UnknownCodeError` в `all-exceptions.filter.spec.ts` (тест
 * №3, fallback 500). Явный cast до `Record<string, number | undefined>` отражает эту реальность
 * и оставляет fallback рабочим — без него `?? FALLBACK_HTTP_STATUS` был бы мёртвым по типу.
 */
function resolveHttpStatus(code: string): number {
  return (ERROR_HTTP_STATUS as Record<string, number | undefined>)[code] ?? FALLBACK_HTTP_STATUS
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
    case HTTP_STATUS_BAD_REQUEST:
      return ErrorCode.VALIDATION_ERROR
    case HTTP_STATUS_UNAUTHORIZED:
      return ErrorCode.UNAUTHENTICATED
    case HTTP_STATUS_FORBIDDEN:
      return ErrorCode.FORBIDDEN
    case HTTP_STATUS_NOT_FOUND:
      return ErrorCode.NOT_FOUND
    case HTTP_STATUS_CONFLICT:
      return ErrorCode.CONFLICT
    case HTTP_STATUS_LOCKED:
      return ErrorCode.OTP_LOCKED
    case HTTP_STATUS_TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED
    default:
      return ErrorCode.INTERNAL_ERROR
  }
}
