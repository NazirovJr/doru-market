import type { IncomingMessage, ServerResponse } from 'node:http'
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import pinoHttp, { type HttpLogger } from 'pino-http'
// no-restricted-imports (C16): см. пояснение в common/health/health.module.ts — `@/` не
// резолвится нативным Node ESM в выводе `tsc`/`nest build` без bundler-шага
// (`assumptions` DTJ-001).
// eslint-disable-next-line no-restricted-imports
import { AppConfigService } from '../../config/app-config.service.js'
import { buildPinoOptions } from './root-logger.js'

const HTTP_ACCESS_LOG_MESSAGE = 'request completed'

/**
 * Автоматический access-лог 1:1 по SRS-NFR-038 (`logger.module.ts`, шаг 5 тикета DTJ-001).
 *
 * ВАЖНО: НЕ переиспользует общий `PINO_LOGGER` (`root-logger.ts`) напрямую через опцию
 * `logger:` — `pino-http@10.5.0` тянет СВОЙ вложенный `pino@9.x` (`pnpm why pino`
 * подтверждает 2 версии в дереве), и его внутренний код (`wrapChild`/`onResFinished`)
 * обращается к приватным символам (`stringifySym`) ИМЕННО этого вложенного `pino`. Передача
 * туда инстанса из НАШЕГО `pino@^10.3.1` ломается в рантайме (`logger[stringifySym] is not
 * a function`) — расхождение версий возможно только через ADR/обновление
 * `01-TECH-BASELINE.md`, вне `files_owned` этого тикета (см. `assumptions` DTJ-001).
 * Поэтому здесь `pino-http` строит СВОЙ внутренний логгер сам (без `logger:`) из ТЕХ ЖЕ
 * опций (`buildPinoOptions` — level/timestamp/redact/mixin, общих с корневым логгером), что
 * даёт идентичный формат вывода без межверсионной поломки.
 *
 * `requestId/tenantId/userId/role` добавляет тот же `mixin`, что и у корневого логгера —
 * здесь же добавляются только поля, специфичные ИМЕННО для access-лога одного запроса
 * (`method/path/statusCode/durationMs`). Стандартные вложенные объекты `req`/`res` от
 * `pino-http` намеренно подавлены (`serializers`) — формат записи обязан быть плоским по
 * SRS-NFR-038, без вложенности.
 */
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly handler: HttpLogger

  constructor(@Inject(AppConfigService) config: AppConfigService) {
    this.handler = pinoHttp({
      ...buildPinoOptions(config),
      customSuccessMessage: () => HTTP_ACCESS_LOG_MESSAGE,
      customErrorMessage: () => HTTP_ACCESS_LOG_MESSAGE,
      customAttributeKeys: { responseTime: 'durationMs' },
      customProps: (req: IncomingMessage, res: ServerResponse) => ({
        method: req.method,
        path: req.url,
        statusCode: res.statusCode,
      }),
      serializers: { req: () => undefined, res: () => undefined },
      // pino-http вызывает `customProps` ДВАЖДЫ: один раз в начале запроса (создавая
      // child-логгер с ранними, ещё не окончательными значениями — `res.statusCode` не
      // определён, `req.url` может быть временно изменён fastify-middie при диспетчеризации
      // мидлвари) и один раз при завершении (корректные финальные значения). Без
      // `quietReqLogger`/`quietResLogger` оба захвата попадают bindings+mergeObject в ОДНУ
      // строку — валидный JSON, но с задвоенными ключами. Отключаем создание
      // request-scoped child-логгера: `res.log`/`req.log` в этом тикете не используются
      // (логирование — через `RequestContext`-mixin корневого логгера), финальный
      // `customProps` остаётся единственным источником `method/path/statusCode`.
      quietReqLogger: true,
      quietResLogger: true,
    })
  }

  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    this.handler(req, res, next)
  }
}
