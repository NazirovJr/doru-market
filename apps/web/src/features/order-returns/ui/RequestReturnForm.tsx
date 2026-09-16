/**
 * `RequestReturnForm` (DTJ-276, EP-11, «Что сделать» п.4) — выбор причины возврата + необязательный
 * комментарий + кнопка отправки. Бизнес-логика (список причин) — `model/return-reason-options.ts`,
 * здесь только композиция и состояние формы (`useState`, п.8 тикета — состояние сервера отдельно,
 * через `api/use-request-return.ts`).
 *
 * **Радио-выбор причины — временный, нативный `<input type="radio">`.** `packages/ui` не несёт
 * `RadioGroup` (`packages/ui/src/index.ts` пуст, проверено; `32-design-reference.md` «Пробелы
 * дизайна» прямо называет `RadioGroup` компонентом без готового визуального покрытия) —
 * `tickets/00-EPICS.md` «Пересекающееся владение» п.6 разрешает временную локальную реализацию с
 * тикетом на перенос в `packages/ui`, когда он появится (см. отчёт сдачи).
 *
 * **`comment` НЕ отправляется на сервер.** `RequestReturnRequestSchema` (DTJ-275, уже смёржен)
 * несёт РОВНО `{ orderId, reason }` — свободного текста при запросе возврата контракт не
 * предусматривает (в отличие от `checklist.notes` у `/confirm`, другой шаг жизненного цикла).
 * Поле оставлено по буквальному тексту тикета («Что сделать» п.4: «комментарий (опционально,
 * Textarea)»), но не участвует в `submit()` — задокументировано для координатора в отчёте сдачи.
 *
 * **Двойной клик (АС2)** — `submitLockRef` (синхронный `useRef`, тот же приём, что
 * `features/checkout/model/use-checkout-form.ts`'s `submitLockRef`): второй `handleSubmit` в той
 * же паре кликов ГАРАНТИРОВАННО видит уже выставленный `true` ДО того, как React успел бы
 * перерисовать что-либо. `isSubmitting` — ОТДЕЛЬНЫЙ `useState` ТОЛЬКО для визуального
 * `disabled`/текста кнопки (тот же приём, что `useCheckoutForm`'s `isSubmitting` ПАРАЛЛЕЛЬНО
 * `submitLockRef`) — `requestReturn.isPending` (состояние TanStack-мутации) обновляется через
 * асинхронный notify-цикл клиента запросов и НЕ гарантированно виден синхронно сразу после
 * `mutate()`, поэтому защита от повторной отправки не может полагаться на него одного.
 */
import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react'
import type { OrderStatus, ReturnReason } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { getAvailableReturnReasons } from '../model/return-reason-options'
import { useRequestReturn, type RequestReturnMutationResult } from '../api/use-request-return'

export interface RequestReturnFormProps {
  readonly orderId: string
  readonly orderStatus: OrderStatus
  readonly onSuccess?: (result: RequestReturnMutationResult) => void
}

export const RequestReturnForm = ({ orderId, orderStatus, onSuccess }: RequestReturnFormProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const availableReasons = getAvailableReturnReasons(orderStatus)
  const [reason, setReason] = useState<ReturnReason | null>(availableReasons[0] ?? null)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const requestReturn = useRequestReturn()
  const submitLockRef = useRef(false)

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (reason === null || submitLockRef.current) {
      return
    }
    submitLockRef.current = true
    setIsSubmitting(true)
    requestReturn.submit(
      { orderId, reason },
      {
        ...(onSuccess !== undefined && { onSuccess }),
        onSettled: () => { submitLockRef.current = false; setIsSubmitting(false) },
      },
    )
  }

  if (availableReasons.length === 0) {
    return (
      <p role="status" data-testid="request-return-unavailable" className="p-4 text-center text-sm text-ink-muted">
        {t('customer.returns.form.unavailable')}
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" data-testid="request-return-form">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-ink">{t('customer.returns.form.reason_label')}</legend>
        {availableReasons.map((value) => (
          <label key={value} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink">
            <input
              type="radio"
              name="return-reason"
              value={value}
              checked={reason === value}
              onChange={() => { setReason(value) }}
              data-testid={`request-return-reason-${value}`}
            />
            {t(`customer.returns.reason.${value}`)}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-sm text-ink">
        {t('customer.returns.form.comment_label')}
        <textarea
          value={comment}
          onChange={(event) => { setComment(event.target.value) }}
          data-testid="request-return-comment"
          rows={4}
          className="rounded-md border border-line px-3 py-2"
        />
      </label>
      {requestReturn.error !== null ? (
        <p role="alert" data-testid="request-return-error" className="text-sm text-brand-danger">
          {t('ux.error.generic_500')}
        </p>
      ) : null}
      {requestReturn.isSuccess ? (
        <p data-testid="request-return-success" className="text-sm text-ink-muted">
          {t('customer.returns.form.success')}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isSubmitting || reason === null}
        data-testid="request-return-submit"
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-4 font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? t('customer.returns.form.submit_pending') : t('customer.returns.form.submit')}
      </button>
    </form>
  )
}
