/**
 * `IdempotencyModule` (EP-01, DTJ-019) — DI для `IdempotencyInterceptor` и
 * in-memory адаптера репозитория.
 *
 * **Production-адаптер Drizzle** (через `idempotency_keys` schema, DTJ-017)
 * заменит `InMemoryIdempotencyKeysRepository` в одном из последующих эпиков
 * (EP-09, первый потребитель `@Idempotent()`). Здесь оставлен явный
 * комментарий, чтобы ревьюер не спутал адаптер с финальной версией.
 */
import { Global, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { InMemoryIdempotencyKeysRepository } from './in-memory-idempotency-keys.repository.js'
import { IdempotencyInterceptor } from './idempotency.interceptor.js'
import { IDEMPOTENCY_KEYS } from './idempotency-keys.repository.js'

@Global()
@Module({
  providers: [
    {
      provide: IDEMPOTENCY_KEYS,
      useClass: InMemoryIdempotencyKeysRepository,
    },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IDEMPOTENCY_KEYS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class IdempotencyModule {}
