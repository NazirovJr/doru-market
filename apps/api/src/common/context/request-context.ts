/**
 * `AsyncLocalStorage`-контекст запроса + инициализирующий его middleware (DTJ-001, шаг 4).
 *
 * ВАЖНО (D-27, files_owned DTJ-001): владение ограничено РОВНО этим файлом, а не всей
 * директорией `common/context/**` — поэтому `RequestContextMiddleware` намеренно живёт
 * здесь же, а не в соседнем файле: тикет не имеет права заводить произвольные новые файлы в
 * этом каталоге. Будущие тикеты (например, `TenantResolutionMiddleware` EP-02) добавляют
 * СВОИ файлы рядом, не трогая этот.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Injectable, type NestMiddleware } from '@nestjs/common'
import { validate as isUuid } from 'uuid'

/**
 * Поля запросного контекста (SRS-NFR-038). `tenantId`/`userId`/`role` инициализируются
 * `null` здесь и заполняются позже — `tenantId` в EP-02 (`TenantResolutionMiddleware`),
 * `userId`/`role` в DTJ-022 (JWT `AuthGuard`) — через `RequestContext.patch(...)`.
 */
export interface RequestContextStore {
  readonly requestId: string
  tenantId: string | null
  userId: string | null
  role: string | null
}

const REQUEST_ID_REQUEST_HEADER = 'x-request-id'
const REQUEST_ID_RESPONSE_HEADER = 'X-Request-Id'

const requestContextStorage = new AsyncLocalStorage<RequestContextStore>()

/**
 * Тонкая обёртка над `AsyncLocalStorage`, распространяющая поля запроса через весь
 * асинхронный стек одного HTTP-запроса — от middleware до самого глубокого лога
 * use case/репозитория (SRS-NFR-038). Используется как логгером (`mixin`, см.
 * `common/logging/root-logger.ts`), так и будущими guard'ами (`RequestContext.patch`).
 *
 * Объект функций, а не класс с одними статиками (C4/`@typescript-eslint/no-extraneous-class`).
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return requestContextStorage.run(store, callback)
  },

  get(): RequestContextStore | undefined {
    return requestContextStorage.getStore()
  },

  /**
   * Точечно дополняет ТЕКУЩИЙ контекст (например, `tenantId` после резолвинга тенанта).
   * Мутирует объект контекста намеренно — это единственный официальный способ записи
   * (`RequestContext.patch(...)`, см. шаг 4 тикета DTJ-001), а не побочный эффект.
   */
  patch(patch: Partial<Omit<RequestContextStore, 'requestId'>>): void {
    const store = requestContextStorage.getStore()
    if (store === undefined) {
      return
    }
    Object.assign(store, patch)
  },
}

function resolveRequestId(headerValue: string | string[] | undefined): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue
  return candidate !== undefined && isUuid(candidate) ? candidate : randomUUID()
}

/**
 * Первое middleware в цепочке (порядок регистрации зафиксирован в `app.module.ts`) —
 * читает/валидирует `X-Request-Id` (SRS-API-011: валидный UUID переиспользуется как есть,
 * иначе генерируется новый) и инициализирует `RequestContext` ДО
 * `TenantResolutionMiddleware` (EP-02), чтобы ошибки резолвинга тенанта уже попадали в лог
 * с корректным `requestId`.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_REQUEST_HEADER])
    res.setHeader(REQUEST_ID_RESPONSE_HEADER, requestId)
    const store: RequestContextStore = { requestId, tenantId: null, userId: null, role: null }
    RequestContext.run(store, next)
  }
}
