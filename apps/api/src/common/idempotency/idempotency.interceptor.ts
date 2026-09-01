/**
 * `IdempotencyInterceptor` (EP-01, DTJ-019, SRS-API-009/010) — глобальный
 * `NestInterceptor`, активный ТОЛЬКО на маршрутах с `@Idempotent()`.
 *
 * 7 веток логики (DTJ-019 «Что сделать» шаг 3):
 *   1. `@Idempotent()` + нет заголовка → `400 IDEMPOTENCY_KEY_REQUIRED` ДО контроллера.
 *   2. Заголовок есть, не валидный UUID v4 → `400 VALIDATION_ERROR`.
 *   3. `requestHash = sha256(JSON.stringify(rawBody))` — канонический
 *      порядок сериализации из распарсенного Fastify body.
 *   4. `findByTriple` → null → `createProcessing` + вызов контроллера +
 *      `markCompleted` на завершение. `createProcessing` бросил
 *      `IdempotencyKeyConflictError` (гонка) → `409 IDEMPOTENCY_KEY_CONFLICT`
 *      немедленно.
 *   5. `status='processing'` найден → `409 IDEMPOTENCY_KEY_CONFLICT`.
 *   6. `status='completed'`, `requestHash` совпадает → возврат сохранённого
 *      `responseStatus`/`responseBody`, контроллер НЕ вызывается.
 *   7. `status='completed'`, `requestHash` НЕ совпадает → `409 IDEMPOTENCY_KEY_CONFLICT`.
 *
 * **Известное ограничение (DTJ-019 «Риски»):** `sha256(JSON.stringify(body))`
 * чувствителен к порядку ключей — два семантически одинаковых, но
 * по-разному сериализованных тела дадут разный хеш. Осознанное упрощение
 * (C15: детерминированная canonicalization — усложнение без прямого
 * требования в SRS).
 */
import {
  ConflictException,
  type CallHandler,
  type ExecutionContext,
  BadRequestException,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { createHash } from 'node:crypto'
import { type FastifyRequest, type FastifyReply } from 'fastify'
import { map, of, Observable, switchMap, tap } from 'rxjs'
import { ErrorCode, type ErrorEnvelope, type SuccessEnvelope, ValidationError } from '@dorutj/contracts'
import { RequestContext } from '@/common/context/request-context.js'
import { IDEMPOTENT_METADATA_KEY } from '@/common/http/decorators/idempotent.decorator.js'
import {
  type IdempotencyKeysRepository,
  IDEMPOTENCY_KEYS,
  IdempotencyKeyConflictError,
} from './idempotency-keys.repository.js'

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEADER_NAME = 'idempotency-key'

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_KEYS) private readonly repo: IdempotencyKeysRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!isIdempotent) {
      return next.handle()
    }

    const http = context.switchToHttp()
    const req = http.getRequest<FastifyRequest & { user?: { id: string } }>()
    const reply = http.getResponse<FastifyReply>()

    const headerValue = req.headers[HEADER_NAME]
    if (typeof headerValue !== 'string' || headerValue.length === 0) {
      throw new BadRequestException(
        new ValidationError(
          'Idempotency-Key header is required',
          { field: HEADER_NAME },
          ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        ),
      )
    }
    if (!UUID_V4_REGEX.test(headerValue)) {
      throw new BadRequestException(
        new ValidationError(
          `Idempotency-Key must be a valid UUID v4: "${headerValue}"`,
          { field: HEADER_NAME, value: headerValue },
          ErrorCode.VALIDATION_ERROR,
        ),
      )
    }

    const userId = readUserId(req)
    const endpoint = `${req.method} ${req.url ?? 'unknown'}`
    const rawBody = readRawBody(req)
    const requestHash = sha256OfBody(rawBody)

    return of(null).pipe(
      switchMap(() => this.processFlow(userId, endpoint, headerValue, requestHash, reply, next)),
    )
  }

  private processFlow(
    userId: string,
    endpoint: string,
    key: string,
    requestHash: string,
    reply: FastifyReply,
    next: CallHandler,
  ): Observable<unknown> {
    return new Observable<unknown>((subscriber) => {
      this.repo
        .findByTriple(userId, endpoint, key)
        .then((existing) => {
          if (existing === null) {
            this.repo
              .createProcessing({ userId, endpoint, key, requestHash })
              .then((created) => {
                next
                  .handle()
                  .pipe(
                    tap((value) => {
                      const status = reply.statusCode ?? 200
                      void this.repo
                        .markCompleted(created.id, status, value as ErrorEnvelope | SuccessEnvelope<unknown>)
                        .catch((err: unknown) => {
                          // markCompleted failure не должен ломать основной ответ.
                          // eslint-disable-next-line no-console -- ops observability
                          console.error('idempotency markCompleted failed', err)
                        })
                    }),
                  )
                  .subscribe({
                    next: (v) => { subscriber.next(v); },
                    error: (err) => { subscriber.error(err); },
                    complete: () => { subscriber.complete(); },
                  })
              })
              .catch((err: unknown) => {
                if (err instanceof IdempotencyKeyConflictError) {
                  subscriber.error(
                    new ConflictException({
                      error: {
                        code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
                        message: 'Idempotency key conflict (concurrent request)',
                        details: { reason: 'concurrent_request' },
                      },
                    }),
                  )
                  return
                }
                subscriber.error(err)
              })
            return
          }
          if (existing.status === 'processing') {
            subscriber.error(
              new ConflictException({
                error: {
                  code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
                  message: 'Idempotency key is still being processed',
                  details: { reason: 'still_processing' },
                },
              }),
            )
            return
          }
          if (existing.requestHash !== requestHash) {
            subscriber.error(
              new ConflictException({
                error: {
                  code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
                  message: 'Idempotency key reused with different body',
                  details: { reason: 'body_mismatch' },
                },
              }),
            )
            return
          }
          if (existing.responseStatus !== null) {
            reply.status(existing.responseStatus)
          }
          subscriber.next(existing.responseBody)
          subscriber.complete()
        })
        .catch((err: unknown) => { subscriber.error(err); })
    }).pipe(map((v) => v))
  }
}

function readUserId(req: FastifyRequest & { user?: { id: string } }): string {
  if (req.user?.id !== undefined) {
    return req.user.id
  }
  const ctxUser = RequestContext.get()?.userId
  if (ctxUser === undefined || ctxUser === null) {
    throw new BadRequestException(
      new ValidationError(
        'Cannot resolve userId for Idempotency-Key check (no auth context)',
        {},
        ErrorCode.UNAUTHENTICATED,
      ),
    )
  }
  return ctxUser
}

function readRawBody(req: FastifyRequest): unknown {
  return (req as unknown as { body?: unknown }).body ?? ''
}

function sha256OfBody(body: unknown): string {
  const json = JSON.stringify(body)
  return createHash('sha256').update(json, 'utf-8').digest('hex')
}
