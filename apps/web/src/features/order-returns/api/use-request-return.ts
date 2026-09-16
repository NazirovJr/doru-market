import { useCallback, useRef } from 'react'
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import type { OrderReturnDto, ReturnReason } from '@dorutj/contracts'
import { requestJsonEnvelope, type HttpError } from '@/shared/api/http-client'

/**
 * `useRequestReturn` (DTJ-276, EP-11, «Что сделать» п.1) — TanStack Query мутация поверх
 * `POST /api/v1/order-returns` (DTJ-275, уже смёржен в development; тело — 1:1
 * `RequestReturnRequestSchema`: `{ orderId, reason }`, ответ — `RequestReturnMutationResult`,
 * зеркалит `RequestReturnResponse` контроллера `order-returns.controller.ts`).
 *
 * `Idempotency-Key` — тот же приём, что `features/checkout/api/use-create-order.ts` (DTJ-235):
 * UUID v4 генерируется ЛЕНИВО, ОДИН РАЗ на попытку отправки формы (`idempotencyKeyRef` —
 * `useRef`, переживает ре-рендеры, не переживает размонтирование) — повторный `submit()` БЕЗ
 * явного `invalidateIdempotencyKey()` переиспользует ТОТ ЖЕ ключ (АС2 тикета: двойной клик,
 * ДАЖЕ если оба долетают до сервера, обязан породить ОДИН возврат — сервер отдаёт сохранённый
 * ответ первой попытки по `IdempotencyInterceptor`, не создаёт вторую запись). Явный сброс — только
 * при новой попытке после провала с изменёнными данными формы (здесь не требуется — форма
 * `RequestReturnForm` не имеет своего `onFormDataChanged`-эффекта, сброс не подключён никем; ключ
 * живёт до размонтирования компонента формы).
 *
 * `retry: 0` — как `useCreateOrder`: TanStack Query не повторяет мутацию сама по себе.
 */
export interface RequestReturnInput {
  readonly orderId: string
  readonly reason: ReturnReason
}

export type RequestReturnMutationResult =
  | { readonly kind: 'return_created'; readonly orderReturn: OrderReturnDto }
  | { readonly kind: 'support_ticket_created'; readonly ticketId: string }

const ORDER_RETURNS_PATH = '/api/v1/order-returns'
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'

async function requestReturn(input: RequestReturnInput, idempotencyKey: string): Promise<RequestReturnMutationResult> {
  const envelope = await requestJsonEnvelope<RequestReturnMutationResult>(ORDER_RETURNS_PATH, {
    method: 'POST',
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    body: JSON.stringify(input),
  })
  return envelope.data
}

export interface UseRequestReturnSubmitOptions {
  readonly onSuccess?: (result: RequestReturnMutationResult) => void
  readonly onSettled?: () => void
}

export interface UseRequestReturnResult {
  readonly submit: (input: RequestReturnInput, options?: UseRequestReturnSubmitOptions) => void
  readonly data: RequestReturnMutationResult | undefined
  readonly error: HttpError | null
  readonly isPending: boolean
  readonly isSuccess: boolean
  readonly invalidateIdempotencyKey: () => void
}

interface RequestReturnMutationVariables {
  readonly input: RequestReturnInput
  readonly idempotencyKey: string
}

export function useRequestReturn(): UseRequestReturnResult {
  const idempotencyKeyRef = useRef<string | null>(null)

  const mutation: UseMutationResult<RequestReturnMutationResult, HttpError, RequestReturnMutationVariables> = useMutation({
    mutationKey: ['order-returns', 'request-return'],
    retry: 0,
    mutationFn: ({ input, idempotencyKey }: RequestReturnMutationVariables) => requestReturn(input, idempotencyKey),
  })

  const submit = useCallback(
    (input: RequestReturnInput, options?: UseRequestReturnSubmitOptions): void => {
      idempotencyKeyRef.current ??= crypto.randomUUID()
      const onSuccess = options?.onSuccess
      mutation.mutate(
        { input, idempotencyKey: idempotencyKeyRef.current },
        {
          // Обёртка, а не передача `onSuccess` напрямую — `mutate()` вызывает колбэк с
          // `(data, variables, context)`, публичный контракт `submit()` обещает вызывающему
          // РОВНО один аргумент (`result`), не протекающие детали TanStack Query.
          ...(onSuccess !== undefined && { onSuccess: (result: RequestReturnMutationResult) => { onSuccess(result) } }),
          ...(options?.onSettled !== undefined && { onSettled: options.onSettled }),
        },
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
    isSuccess: mutation.isSuccess,
    invalidateIdempotencyKey,
  }
}
