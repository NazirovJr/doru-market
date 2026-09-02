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
 *      немедленно. Обработчик бросил ошибку → `releaseProcessing` снимает
 *      запись (повтор с тем же ключом снова дойдёт до обработчика), а
 *      исходная ошибка пробрасывается клиенту БЕЗ ИЗМЕНЕНИЙ — успешный ответ
 *      не кэшируется, поэтому и ошибочный кэшировать нельзя (DTJ-019 fix).
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
import { map, of, Observable, switchMap, tap, type Subscriber } from 'rxjs'
import { ErrorCode, type ErrorEnvelope, type SuccessEnvelope, ValidationError } from '@dorutj/contracts'
import { RequestContext } from '@/common/context/request-context.js'
import { IDEMPOTENT_METADATA_KEY } from '@/common/http/decorators/idempotent.decorator.js'
import { HTTP_STATUS_OK } from '@/common/http/http-status.constants.js'
import {
  type IdempotencyKeyRecord,
  type IdempotencyKeysRepository,
  IDEMPOTENCY_KEYS,
  IdempotencyKeyConflictError,
} from './idempotency-keys.repository.js'

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEADER_NAME = 'idempotency-key'

interface ProcessFlowInput {
  userId: string
  endpoint: string
  key: string
  requestHash: string
  reply: FastifyReply
  next: CallHandler
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  // Явный @Inject на КАЖДОМ параметре: esbuild (vitest) не эмитит `design:paramtypes` (DTJ-001).
  // Здесь это роняло бут целиком: недекорированный параметр с индексом МЕНЬШЕ декорированного
  // попадает в paramtypes как `undefined`, Nest пытается резолвить токен `undefined` и падает
  // с «can't resolve dependencies of the IdempotencyInterceptor (?, ...)». Интерцептор
  // зарегистрирован глобально (APP_INTERCEPTOR в `idempotency.module.ts`), поэтому не
  // поднимался весь AppModule.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
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
    // `req.url` типизирован как всегда-`string` (FastifyRequest), фолбэк был мёртвым кодом.
    const endpoint = `${req.method} ${req.url}`
    const rawBody = readRawBody(req)
    const requestHash = sha256OfBody(rawBody)

    return of(null).pipe(
      switchMap(() =>
        this.processFlow({ userId, endpoint, key: headerValue, requestHash, reply, next }),
      ),
    )
  }

  private processFlow(input: ProcessFlowInput): Observable<unknown> {
    const { userId, endpoint, key } = input
    return new Observable<unknown>((subscriber) => {
      this.repo
        .findByTriple(userId, endpoint, key)
        .then((existing) => {
          if (existing === null) {
            this.startNewProcessing(input, subscriber)
            return
          }
          this.resolveExisting(existing, input, subscriber)
        })
        .catch((err: unknown) => { subscriber.error(err); })
    }).pipe(map((v) => v))
  }

  /** Ветка 4 (нет записи): создаёт `processing` и запускает обработчик. Гонка на `createProcessing` → 409. */
  private startNewProcessing(input: ProcessFlowInput, subscriber: Subscriber<unknown>): void {
    const { userId, endpoint, key, requestHash, reply, next } = input
    this.repo
      .createProcessing({ userId, endpoint, key, requestHash })
      .then((created) => { this.runHandlerAndRecord({ created, reply, next }, subscriber); })
      .catch((err: unknown) => { this.failCreateProcessing(err, subscriber); })
  }

  private runHandlerAndRecord(
    ctx: { created: IdempotencyKeyRecord; reply: FastifyReply; next: CallHandler },
    subscriber: Subscriber<unknown>,
  ): void {
    const { created, reply, next } = ctx
    next
      .handle()
      .pipe(
        // tap({ next, error }) — с одной функцией tap реагирует ТОЛЬКО на next
        // (сюда и попадал прежний дефект: ошибка обработчика навсегда оставляла
        // запись в status=processing). Ветка error освобождает запись и НЕ
        // трогает саму ошибку — она уходит дальше по цепочке как есть.
        tap({
          next: (value) => { this.recordCompletion(created.id, reply, value); },
          error: () => { this.releaseOnError(created.id); },
        }),
      )
      .subscribe({
        next: (v) => { subscriber.next(v); },
        error: (err) => { subscriber.error(err); },
        complete: () => { subscriber.complete(); },
      })
  }

  private recordCompletion(id: string, reply: FastifyReply, value: unknown): void {
    const status = readStatusCode(reply) ?? HTTP_STATUS_OK
    void this.repo
      .markCompleted(id, status, value as ErrorEnvelope | SuccessEnvelope<unknown>)
      .catch((err: unknown) => {
        // markCompleted failure не должен ломать основной ответ.
        // eslint-disable-next-line no-console -- ops observability
        console.error('idempotency markCompleted failed', err)
      })
  }

  private releaseOnError(id: string): void {
    void this.repo.releaseProcessing(id).catch((err: unknown) => {
      // releaseProcessing failure не должен подменять исходную ошибку обработчика.
      // eslint-disable-next-line no-console -- ops observability
      console.error('idempotency releaseProcessing failed', err)
    })
  }

  private failCreateProcessing(err: unknown, subscriber: Subscriber<unknown>): void {
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
  }

  /** Ветки 5–7 (запись уже существует): processing → 409, body-мисматч → 409, иначе — кэшированный ответ. */
  private resolveExisting(
    existing: IdempotencyKeyRecord,
    input: ProcessFlowInput,
    subscriber: Subscriber<unknown>,
  ): void {
    const { requestHash, reply } = input
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
  }
}

/**
 * `ExecutionContext.switchToHttp().getResponse<FastifyReply>()` — непроверяемый generic
 * cast (Nest не валидирует, что переданный объект реально соответствует `FastifyReply`).
 * Тип `FastifyReply.statusCode` объявлен как всегда-`number`, но это гарантия ТОЛЬКО для
 * настоящего fastify-реплая; здесь читаем защитно как `number | undefined`, чтобы не терять
 * дефолт `HTTP_STATUS_OK` для любого объекта, дошедшего до `getResponse<T>()`.
 */
function readStatusCode(reply: FastifyReply): number | undefined {
  return (reply as unknown as { statusCode: number | undefined }).statusCode
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
