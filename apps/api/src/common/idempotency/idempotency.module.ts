/**
 * `IdempotencyModule` (EP-01, DTJ-019) — DI для `IdempotencyInterceptor` и
 * репозитория ключей идемпотентности.
 *
 * **Production-адаптер Drizzle подключён (DTJ-227, D-EP09-18)** — `DrizzleIdempotencyKeysRepository`
 * (через `idempotency_keys` schema, DTJ-017) заменяет `InMemoryIdempotencyKeysRepository`
 * начиная с этого тикета (EP-09, первый потребитель `@Idempotent()` — `CheckoutUseCase`
 * читает/пишет через ТОТ ЖЕ токен `IDEMPOTENCY_KEYS`, см. `orders/infrastructure/adapters/
 * idempotency-attempt.adapter.ts`). `InMemoryIdempotencyKeysRepository` остаётся в дереве —
 * используется юнит-тестами `IdempotencyInterceptor`, конструируется напрямую `new`, не через
 * DI.
 */
import { Global, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { IdempotencyInterceptor } from './idempotency.interceptor.js'
import { IDEMPOTENCY_KEYS_DRIZZLE_PROVIDER } from './drizzle-idempotency-keys.repository.js'
import { IDEMPOTENCY_KEYS } from './idempotency-keys.repository.js'

@Global()
@Module({
  providers: [
    IDEMPOTENCY_KEYS_DRIZZLE_PROVIDER,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IDEMPOTENCY_KEYS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class IdempotencyModule {}
