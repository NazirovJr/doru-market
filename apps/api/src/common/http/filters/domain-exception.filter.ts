/**
 * `DomainExceptionFilter` (EP-01, DTJ-018, SRS-API-016, SRS-DOM-153) — глобальный
 * фильтр `@Catch(DomainError)`, маппит доменные ошибки → `ErrorEnvelope` с
 * HTTP-статусом из `ERROR_HTTP_STATUS` (DTJ-005).
 *
 * Регистрация: `APP_FILTER` в `app.module.ts` ПЕРЕД `TransportExceptionFilter`
 * (более специфичный фильтр должен идти первым, иначе catch-all его перехватит).
 *
 * **Безопасность `details` в production (SRS-API-014, решение CTO по DTJ-193):**
 * маскируется РОВНО статус `500` — `code` подменяется на `INTERNAL_ERROR`, `details`
 * принудительно заменяется на `{ requestId }` из `RequestContext` (DTJ-001), остальные
 * поля `error.details` опускаются. Stack trace никогда не попадает в HTTP-ответ
 * (только в pino-логе сервера).
 *
 * Остальные статусы 5xx (`502 BAD_GATEWAY`, `503 SERVICE_UNAVAILABLE` и т.п.) —
 * НЕ маскируются: это намеренные, документированные сигналы доступности, часть
 * публичного контракта API (`ErrorCode` — закрытый каталог из `@dorutj/contracts`,
 * коды по определению безопасны для клиента). Их `code` и `details` доходят до
 * клиента как есть, наравне с 4xx. Пример: `SearchServiceUnavailableError` (DTJ-190)
 * отдаёт `503 SERVICE_UNAVAILABLE` с `details.reason = "search_temporarily_degraded"` —
 * экран результатов поиска должен отличить эту деградацию от общей ошибки, что
 * невозможно, если фильтр стирает `details` для любого статуса `>= 500`.
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
import { HTTP_STATUS_INTERNAL_SERVER_ERROR } from '../http-status.constants.js'

const FALLBACK_HTTP_STATUS = HTTP_STATUS_INTERNAL_SERVER_ERROR
/** Статус, чьи `code`/`details` маскируются (SRS-API-014) — РОВНО 500, не весь диапазон 5xx. */
const MASKED_INTERNAL_ERROR_STATUS = 500

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()

    const status = resolveHttpStatus(exception.code)
    const isMaskedInternalError = status === MASKED_INTERNAL_ERROR_STATUS
    const details = resolveDetails(exception, isMaskedInternalError)

    const envelope: ErrorEnvelope = {
      error: {
        code: isMaskedInternalError ? ErrorCode.INTERNAL_ERROR : exception.code,
        message: isMaskedInternalError ? 'Internal server error' : exception.message,
        ...(details !== undefined && Object.keys(details).length > 0 ? { details } : {}),
      },
    }
    reply.status(status).send(envelope)
  }
}

/**
 * `ERROR_HTTP_STATUS: Record<ErrorCode, number>` гарантирует статус для КАЖДОГО валидного
 * `ErrorCode` — но `exception.code` в рантайме не обязан быть валидным `ErrorCode`: `DomainError`
 * лишь ОБЪЯВЛЯЕТ поле `code: ErrorCode`, а реальное значение может прийти в обход компилятора
 * (легаси-код, `as ErrorCode`) — см. симметричный случай `UnknownCodeError` в
 * `all-exceptions.filter.spec.ts` (тест №3, fallback 500). Явный cast до
 * `Record<string, number | undefined>` отражает эту реальность и оставляет fallback рабочим —
 * без него `?? FALLBACK_HTTP_STATUS` был бы мёртвым по типу.
 */
function resolveHttpStatus(code: string): number {
  return (ERROR_HTTP_STATUS as Record<string, number | undefined>)[code] ?? FALLBACK_HTTP_STATUS
}

/**
 * **Безопасность `details` в production (SRS-API-014):** только для статуса РОВНО `500`
 * `details` принудительно заменяется на `{ requestId }` (если есть в `RequestContext`,
 * DTJ-001) — независимо от окружения (prod/dev/test): это непреднамеренная серверная
 * ошибка, её `exception.details` могут содержать внутренности, которые нельзя показывать
 * клиенту. Для остальных статусов (4xx и намеренные 5xx вроде `503`) `exception.details`
 * уже безопасны по контракту `DomainError` (закрытый каталог `ErrorCode`) и пробрасываются
 * как есть.
 */
function resolveDetails(exception: DomainError, isMaskedInternalError: boolean): Record<string, unknown> | undefined {
  if (!isMaskedInternalError) {
    return exception.details
  }
  const requestId = RequestContext.get()?.requestId
  return requestId === undefined ? {} : { requestId }
}
