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

const FALLBACK_HTTP_STATUS = 500

@Catch()
export class TransportExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TransportExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
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
      `Неожиданное исключение в request handler: ${exception instanceof Error ? exception.stack : String(exception)}`,
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
