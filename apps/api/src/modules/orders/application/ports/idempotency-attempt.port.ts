/**
 * `IdempotencyAttemptAdapter` (EP-09, DTJ-227, «Что сделать» п.4, SRS-API-009/010) — порт.
 * Вынесен из `infrastructure/adapters/idempotency-attempt.adapter.ts` в собственный
 * application-порт (`02` §1.1: application не импортирует infrastructure напрямую, только
 * объявляет порт, который infrastructure реализует) — тот же паттерн, что и остальные порты
 * `application/ports/*.port.ts` этого модуля.
 *
 * Тонкая типизированная обёртка вокруг ОБЩЕГО механизма `idempotency_keys`
 * (`common/idempotency/idempotency-keys.repository.ts`, EP-01 DTJ-017/019) СПЕЦИФИЧНО для
 * checkout — не переизобретение общего механизма (D-EP09-4: локальный fallback запрещён).
 * Используется `CheckoutUseCase` НАПРЯМУЮ (не через HTTP-слой `IdempotencyInterceptor`,
 * который активируется только на `@Idempotent()`-маршрутах — presentation/контроллер
 * `POST /api/v1/orders`, DTJ-233, вне периметра этого тикета).
 */
import type { CheckoutResultDto } from '@/modules/orders/application/checkout/dto/checkout-result.dto.js'

export const IDEMPOTENCY_ATTEMPT_ADAPTER = Symbol.for('@dorutj/orders/idempotency-attempt-adapter')

/** Не HTTP-маршрут — константа application-уровня идемпотентности. */
export const CHECKOUT_IDEMPOTENCY_ENDPOINT = 'checkout:create-orders'

export interface IdempotencyAttemptAdapter {
  /**
   * `null` — попытки не было, продолжай (`begin`). Иначе — уже ЗАВЕРШЁННЫЙ результат (тот же
   * запрос) для возврата БЕЗ повторного выполнения бизнес-логики. `payload` с ДРУГИМ телом
   * (несовпадение хэша) или `processing` (гонка) → `IdempotencyKeyConflictError`.
   */
  findCompleted(userId: string, checkoutAttemptId: string, payload: unknown): Promise<CheckoutResultDto | null>
  /** Создаёт `processing`-запись, возвращает `id` для `complete`/`release`. Гонка → `IdempotencyKeyConflictError`. */
  begin(userId: string, checkoutAttemptId: string, payload: unknown): Promise<string>
  complete(id: string, result: CheckoutResultDto): Promise<void>
  release(id: string): Promise<void>
}
