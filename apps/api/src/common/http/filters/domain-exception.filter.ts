/**
 * `DomainExceptionFilter` (EP-01, DTJ-018, SRS-API-016, SRS-DOM-153) — глобальный
 * фильтр `@Catch(DomainError)`, маппит доменные ошибки → `ErrorEnvelope` с
 * HTTP-статусом из `ERROR_HTTP_STATUS` (DTJ-005).
 *
 * Регистрация: `APP_FILTER` в `app.module.ts` ПЕРЕД `TransportExceptionFilter`
 * (более специфичный фильтр должен идти первым, иначе catch-all его перехватит).
 *
 * **Безопасность `details` в production (SRS-API-014):** для статуса `500`
 * `details` принудительно заменяется на `{ requestId }` из `RequestContext`
 * (DTJ-001), остальные поля `error.details` опускаются. Stack trace никогда
 * не попадает в HTTP-ответ (только в pino-логе сервера).
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
} from '@nestjs/common'
import {
  DomainError,
  ERROR_HTTP_STATUS,
  type ErrorEnvelope,
  ErrorCode,
} from '@dorutj/contracts'
import { type FastifyReply } from 'fastify'
import { RequestContext } from '@/common/context/request-context.js'

const FALLBACK_HTTP_STATUS = 500

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()

    const status = ERROR_HTTP_STATUS[exception.code] ?? FALLBACK_HTTP_STATUS
    const isProduction = process.env.NODE_ENV === 'production'
    const isServerError = status >= 500

    let details: Record<string, unknown> | undefined
    if (isServerError && isProduction) {
      const requestId = RequestContext.get()?.requestId
      details = requestId === undefined ? {} : { requestId }
    } else if (isServerError) {
      // dev/test: добавляем requestId (если есть), остальные details НЕ раскрываем
      const requestId = RequestContext.get()?.requestId
      details = requestId === undefined ? {} : { requestId }
    } else {
      details = exception.details
    }

    const envelope: ErrorEnvelope = {
      error: {
        code: isServerError ? ErrorCode.INTERNAL_ERROR : exception.code,
        message: isServerError ? 'Internal server error' : exception.message,
        ...(details !== undefined && Object.keys(details).length > 0 ? { details } : {}),
      },
    }
    reply.status(status).send(envelope)
  }
}
