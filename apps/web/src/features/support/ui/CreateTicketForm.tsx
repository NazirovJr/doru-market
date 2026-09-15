/**
 * `CreateTicketForm` (DTJ-284) — категория (6 значений `support_ticket_category`) + текст
 * обращения (обязателен). `orderId` — проп, не читается из URL здесь (страница-контейнер решает,
 * откуда он берётся, см. `pages/support/create-ticket-page.tsx`) — компонент переиспользуем
 * независимо от точки входа (кнопка на будущем `/orders/:id` ИЛИ общий экран `/support`).
 * ≤150 строк (DTJ-284 DoD), состояние — `useState`, отправка — через `api/use-create-ticket.ts`.
 */
import { useState, type ReactElement, type SyntheticEvent } from 'react'
import { SUPPORT_TICKET_CATEGORY_VALUES, type SupportTicketCategory } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { useCreateTicket } from '../api/use-create-ticket'

const DEFAULT_CATEGORY: SupportTicketCategory = SUPPORT_TICKET_CATEGORY_VALUES[0]
const MIN_DESCRIPTION_LENGTH = 1

export interface CreateTicketFormProps {
  readonly orderId?: string
  readonly onCreated?: (ticketId: string) => void
}

export const CreateTicketForm = ({ orderId, onCreated }: CreateTicketFormProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [category, setCategory] = useState<SupportTicketCategory>(DEFAULT_CATEGORY)
  const [description, setDescription] = useState('')
  const createTicket = useCreateTicket()

  const isDescriptionValid = description.trim().length >= MIN_DESCRIPTION_LENGTH

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!isDescriptionValid) {
      return
    }
    createTicket.mutate(
      { category, description, ...(orderId !== undefined && { orderId }) },
      { onSuccess: (ticket) => { setDescription(''); onCreated?.(ticket.id) } },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" data-testid="create-ticket-form">
      <label className="flex flex-col gap-1 text-sm text-ink">
        {t('customer.support.form.category_label')}
        <select
          value={category}
          onChange={(event) => { setCategory(event.target.value as SupportTicketCategory) }}
          data-testid="create-ticket-category"
          className="rounded-md border border-line px-3 py-2"
        >
          {SUPPORT_TICKET_CATEGORY_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`support.category.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        {t('customer.support.form.description_label')}
        <textarea
          value={description}
          onChange={(event) => { setDescription(event.target.value) }}
          data-testid="create-ticket-description"
          rows={5}
          required
          className="rounded-md border border-line px-3 py-2"
        />
      </label>
      {createTicket.error !== null ? (
        <p role="alert" data-testid="create-ticket-error" className="text-sm text-brand-danger">
          {t('ux.error.generic_500')}
        </p>
      ) : null}
      {createTicket.isSuccess ? (
        <p data-testid="create-ticket-success" className="text-sm text-ink-muted">
          {t('customer.support.form.success')}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={createTicket.isPending || !isDescriptionValid}
        data-testid="create-ticket-submit"
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-4 font-semibold text-white disabled:opacity-50"
      >
        {createTicket.isPending ? t('customer.support.form.submit_pending') : t('customer.support.form.submit')}
      </button>
    </form>
  )
}
