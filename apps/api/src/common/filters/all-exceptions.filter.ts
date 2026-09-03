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
 * маппятся в `500 INTERNAL_ERROR`: наружу уходит только `requestId` (по нему ops
 * находит запись в логе), stack trace в HTTP не попадает никогда.
 *
 * **Это ЕДИНСТВЕННЫЙ фильтр приложения.** Раньше рядом были зарегистрированы ещё два —
 * `DomainExceptionFilter` (`@Catch(DomainError)`) и `TransportExceptionFilter` (`@Catch()`)
 * через `APP_FILTER` в `app.module.ts`. Оба были НЕДОСТИЖИМЫ: NestJS отдаёт исключение первому
 * подходящему фильтру, и им всегда оказывался этот. Доказано интеграционно —
 * `test/integration/auth/cross-tenant-leakage.spec.ts` получает `403 CROSS_TENANT_ACCESS_DENIED`,
 * тогда как `TransportExceptionFilter` на том же исключении отдал бы `401 UNAUTHENTICATED`.
 * Их юнит-тесты при этом были зелёными и описывали поведение, которого не видел ни один клиент, —
 * то есть работали ловушкой: правка «фильтра ошибок» ничего не меняла в проде. Удалены
 * (решение CTO, волна 6); из `DomainExceptionFilter` сюда перенесена маскировка статуса 500.
 *
 * Регистрация:
 *   `app.useGlobalFilters(new AllExceptionsFilter())` в main.ts и в тестовых харнессах
 *   (`test/integration/.../test-app.ts`) — НЕ через `APP_FILTER`.
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
} from '../http/http-status.constants.js'

const FALLBACK_HTTP_STATUS = HTTP_STATUS_INTERNAL_SERVER_ERROR
/** Статус, чьи `code`/`details` маскируются (SRS-API-014, DTJ-193) — РОВНО 500, не весь 5xx:
 *  503 — намеренная деградация, её `code`/`details.reason` обязаны дойти до клиента. */
const MASKED_INTERNAL_ERROR_STATUS = HTTP_STATUS_INTERNAL_SERVER_ERROR
const INTERNAL_ERROR_MESSAGE = 'Internal server error'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()

    if (exception instanceof DomainError) {
      this.sendDomainError(exception, reply)
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
    const details = maskedDetails()
    const envelope: ErrorEnvelope = {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: INTERNAL_ERROR_MESSAGE,
        ...(Object.keys(details).length > 0 ? { details } : {}),
      },
    }
    reply.status(FALLBACK_HTTP_STATUS).send(envelope)
  }

  /** Доменная ошибка: статус и код — из `ERROR_HTTP_STATUS`, с маскировкой ровно на 500. */
  private sendDomainError(exception: DomainError, reply: FastifyReply): void {
    const status = resolveHttpStatus(exception.code)
    const isMasked = status === MASKED_INTERNAL_ERROR_STATUS
    const details = isMasked ? maskedDetails() : exception.details
    const envelope: ErrorEnvelope = {
      error: {
        code: isMasked ? ErrorCode.INTERNAL_ERROR : exception.code,
        message: isMasked ? INTERNAL_ERROR_MESSAGE : exception.message,
        ...(details !== undefined && Object.keys(details).length > 0 ? { details } : {}),
      },
    }
    reply.status(status).send(envelope)
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
    // `getResponse()` типизирован как `string | object`, но исключение сюда приходит из
    // произвольного места приложения — типизирован намеренно как `unknown`, чтобы не
    // терять runtime-проверку `body !== null` (защита от `HttpException`, созданных в обход
    // штатного конструктора, напр. сторонним кодом через `as any`).
    const source = readErrorSource(exception.getResponse())
    const message = source !== null && 'message' in source ? String(source.message) : exception.message
    const explicitCode = extractErrorCode(source)
    const status = explicitCode !== null ? ERROR_HTTP_STATUS[explicitCode] : exception.getStatus()
    const isMasked = status === MASKED_INTERNAL_ERROR_STATUS
    const details = isMasked ? maskedDetails() : readDetails(source)
    const envelope: ErrorEnvelope = {
      error: {
        code: isMasked ? ErrorCode.INTERNAL_ERROR : (explicitCode ?? mapHttpStatusToCode(status)),
        message: isMasked ? INTERNAL_ERROR_MESSAGE : message,
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
function extractErrorCode(source: Record<string, unknown> | null): ErrorCode | null {
  const candidate = source?.code
  return typeof candidate === 'string' && candidate in ERROR_HTTP_STATUS ? (candidate as ErrorCode) : null
}

/**
 * Разворачивает тело `HttpException` до объекта, несущего `code`/`message`/`details`.
 *
 * В проекте сосуществуют ДВЕ формы, и обе легальны:
 *   - плоская `{ code, message }` — гварды (`AuthGuard`/`RolesGuard`/`CartIdentityGuard`);
 *   - полный конверт `{ error: { code, message, details } }` — `ZodValidationPipe`,
 *     `IdempotencyInterceptor`.
 * Раньше читалась только плоская: у Zod-пайпа `code`/`details` лежат на уровень глубже, поэтому
 * `details.issues` (какое поле не прошло валидацию) терялись целиком, а `message` откатывался на
 * `exception.message`, то есть на строку NestJS «Bad Request Exception». Клиент получал ответ,
 * по которому невозможно понять, что именно он прислал не так.
 *
 * Тело нативного Nest-исключения (`{ statusCode, message, error: 'Bad Request' }`) не
 * разворачивается: `error` там — строка, а не объект.
 */
function readErrorSource(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const record = body as Record<string, unknown>
  const nested: unknown = record.error
  return typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : record
}

function readDetails(source: Record<string, unknown> | null): Record<string, unknown> | undefined {
  const details = source?.details
  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return undefined
  }
  return details as Record<string, unknown>
}

/** Маскировка статуса 500 (SRS-API-014, решение CTO по DTJ-193) — наружу только `requestId`. */
function maskedDetails(): Record<string, unknown> {
  const requestId = RequestContext.get()?.requestId
  return requestId === undefined ? {} : { requestId }
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
