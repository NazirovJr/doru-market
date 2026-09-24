import pino, { type Logger, type LoggerOptions } from 'pino'
// no-restricted-imports (C16): см. пояснение в common/health/health.module.ts — `@/` не
// резолвится нативным Node ESM в выводе `tsc`/`nest build` без bundler-шага
// (`assumptions` DTJ-001).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится нативным Node ESM в эмитированном tsc/nest build без bundler-шага (assumptions DTJ-001); относительный путь — единственный рабочий вариант без новых зависимостей.
import type { AppConfigService } from '../../config/app-config.service.js'
import { SENSITIVE_FIELD_REDACT_PATHS } from '@dorutj/contracts'
import { RequestContext } from '../context/request-context.js'

/**
 * SRS-API-068: заголовки, которые никогда не должны попасть в лог целиком — секреты
 * сессии/доступа. `remove: true` полностью убирает поле, а не маскирует.
 */
// 'x-cart-session-token' (EP-09, DTJ-226, D-EP09-23) — гостевой bearer-секрет корзины,
// та же категория, что 'x-pharmacy-api-key': полностью опускается, не маскируется частично.
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers["x-pharmacy-api-key"]',
  'req.headers["x-cart-session-token"]',
] as const

/** Плоские поля SRS-NFR-038, подмешиваемые в каждую лог-запись внутри активного запроса. */
function mixinRequestContextFields(): Record<string, unknown> {
  const store = RequestContext.get()
  return store === undefined
    ? {}
    : { requestId: store.requestId, tenantId: store.tenantId, userId: store.userId, role: store.role }
}

/**
 * Опции pino вынесены в чистую функцию отдельно от `createRootLogger` — так `mixin`
 * тестируется юнит-тестом напрямую, без реального логгера/потока вывода.
 */
export function buildPinoOptions(config: AppConfigService): LoggerOptions {
  return {
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    // Пути полей заголовков + общий список чувствительных полей.
    redact: { paths: [...REDACTED_PATHS, ...SENSITIVE_FIELD_REDACT_PATHS], remove: true },
    mixin: mixinRequestContextFields,
  }
}

/**
 * Единый pino-логгер процесса (SRS-NFR-038, `logger.module.ts` шаг 5 тикета DTJ-001).
 * `mixin` подмешивает поля запросного контекста (`requestId/tenantId/userId/role`) в
 * КАЖДУЮ запись, сделанную через этот логгер — не только автологи `pino-http`
 * (`http-logger.middleware.ts`), но и любой лог из middleware/guard/use case/репозитория
 * в рамках одного HTTP-запроса.
 */
export function createRootLogger(config: AppConfigService): Logger {
  return pino(buildPinoOptions(config))
}
