/**
 * `TransportExceptionFilter` (EP-01, DTJ-018, SRS-API-016) — catch-all `@Catch()`
 * фильтр. Регистрируется ПОСЛЕ `DomainExceptionFilter`, чтобы доменные ошибки
 * (потомки `DomainError`) не долетали сюда (NestJS применяет фильтры в порядке
 * регистрации, более специфичные — первыми).
 *
 * **Что ловит:**
 *   - `HttpException` (NestJS) → маппинг 1:1 (`404 NOT_FOUND`, `400 VALIDATION_ERROR` и т.д.);
 *   - прочие `Error` / `unknown` → `500 INTERNAL_ERROR` (stack — только в pino-лог).
 *
 * **`HttpException`-исключения** оборачиваются в `ErrorEnvelope` (SRS-API-014).
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import {
  type ErrorEnvelope,
  ErrorCode,
} from '@dorutj/contracts'
import { type FastifyReply } from 'fastify'
import { RequestContext } from '@/common/context/request-context.js'
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_CONFLICT,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_LOCKED,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
} from '../http-status.constants.js'

const FALLBACK_HTTP_STATUS = HTTP_STATUS_INTERNAL_SERVER_ERROR

@Catch()
export class TransportExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TransportExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()

    if (exception instanceof HttpException) {
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
      const envelope: ErrorEnvelope = {
        error: { code: mapHttpStatusToCode(status), message },
      }
      reply.status(status).send(envelope)
      return
    }

    // Неожиданное исключение — НЕ раскрываем stack в HTTP, логируем подробно.
    this.logger.error(
      `Неожиданное исключение в request handler: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
    )
    const requestId = RequestContext.get()?.requestId
    const envelope: ErrorEnvelope = {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        ...(requestId !== undefined ? { details: { requestId } } : {}),
      },
    }
    reply.status(FALLBACK_HTTP_STATUS).send(envelope)
  }
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
