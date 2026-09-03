import { useCallback, useRef } from 'react'
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import type { HttpError } from '@/shared/api/http-client'
import { createOrder, type CreateOrderInput, type CreateOrderResponse } from './create-order.api'

/**
 * `use-create-order.ts` (DTJ-235, «Что сделать» §1) — мутация `POST /api/v1/orders` +
 * управление `Idempotency-Key` (UUID v4, `crypto.randomUUID()` — уже нативно доступен в целевых
 * браузерах/Node без новой зависимости, правило 10 AGENTS.md «нужен пакет — спроси», здесь пакет
 * не нужен).
 *
 * **Правило генерации ключа (тикет, дословно): «ОДИН РАЗ на попытку отправки формы (не на
 * каждый рендер) — ключ переиспользуется при ретрае того же запроса, новый генерируется только
 * при явном изменении данных формы пользователем после провала».** Реализовано через
 * `idempotencyKeyRef` (`useRef`, переживает ре-рендеры, НЕ переживает размонтирование компонента
 * — в рамках одной попытки оформления это и есть «одна попытка»):
 *   - `submit()` генерирует ключ ЛЕНИВО, только если `idempotencyKeyRef.current === null`
 *     (`??=`) — НЕ на монтировании хука, НЕ на каждом рендере;
 *   - повторный вызов `submit()` (пользователь нажал «Оформить заказ» ещё раз после сетевой
 *     ошибки/провала, НЕ меняя полей формы) видит УЖЕ УСТАНОВЛЕННЫЙ `ref.current` и переиспользует
 *     его — тот же ключ долетает до сервера дважды, `IdempotencyInterceptor`
 *     (`apps/api/.../idempotency.interceptor.ts`, прочитан целиком) отдаёт СОХРАНЁННЫЙ ответ
 *     первой попытки, а не создаёт второй заказ (это и есть definse in depth ПОВЕРХ серверной
 *     идемпотентности из тикета: два параллельных запроса с одним ключом уже дают один `200` и
 *     `409 IDEMPOTENCY_KEY_CONFLICT` на сервере — здесь клиент просто гарантирует, что ключ для
 *     одной и той же логической попытки НИКОГДА не меняется сам по себе);
 *   - `invalidateIdempotencyKey()` — вызывается `checkout-screen.tsx` из `use-checkout-form.ts`'s
 *     `onFormDataChanged` (см. его JSDoc) — сбрасывает `ref.current` в `null`, следующий `submit()`
 *     сгенерирует НОВЫЙ ключ, потому что тело запроса теперь другое (иначе идемпотентный кэш
 *     сервера отдал бы ответ на СТАРОЕ тело под новыми данными — тот же риск, что переиспользование
 *     ключа между семантически разными запросами, `idempotency.interceptor.ts` JSDoc п.7).
 *
 * `retry: 0` — как `use-request-otp.ts` (EP-01): TanStack Query не должен сам повторять `POST
 * /orders` в фоне без ведома пользователя (двойной клик уже отрезан `use-checkout-form.ts`'s
 * `submitLockRef` НИЖЕ по стеку вызовов — до вызова `submit()` вообще).
 */
export interface UseCreateOrderResult {
  readonly submit: (input: CreateOrderInput, options?: { readonly onSettled?: () => void }) => void
  readonly data: CreateOrderResponse | undefined
  readonly error: HttpError | null
  readonly isPending: boolean
  readonly invalidateIdempotencyKey: () => void
}

interface CreateOrderMutationVariables {
  readonly input: CreateOrderInput
  readonly idempotencyKey: string
}

export function useCreateOrder(): UseCreateOrderResult {
  const idempotencyKeyRef = useRef<string | null>(null)

  const mutation: UseMutationResult<CreateOrderResponse, HttpError, CreateOrderMutationVariables> = useMutation({
    mutationKey: ['checkout', 'create-order'],
    retry: 0,
    mutationFn: ({ input, idempotencyKey }: CreateOrderMutationVariables) => createOrder(input, idempotencyKey),
  })

  const submit = useCallback(
    (input: CreateOrderInput, options?: { readonly onSettled?: () => void }): void => {
      idempotencyKeyRef.current ??= crypto.randomUUID()
      mutation.mutate(
        { input, idempotencyKey: idempotencyKeyRef.current },
        options?.onSettled === undefined ? undefined : { onSettled: options.onSettled },
      )
    },
    [mutation],
  )

  const invalidateIdempotencyKey = useCallback((): void => {
    idempotencyKeyRef.current = null
  }, [])

  return {
    submit,
    data: mutation.data,
    error: mutation.error,
    isPending: mutation.isPending,
    invalidateIdempotencyKey,
  }
}
