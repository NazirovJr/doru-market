/**
 * `SupportTicketDetail` (DTJ-283) — деталь тикета: метаданные, лента сообщений, поле ответа
 * (`use-respond-ticket.ts`), кнопки смены статуса (`use-change-ticket-status.ts`) — скрыты для
 * терминального `closed` (АС3 тикета: «терминальное состояние визуально финально»).
 *
 * `NEXT_STATUS_BY_CURRENT` — клиентское ЗЕРКАЛО `ALLOWED_TRANSITIONS` домена
 * (`support-ticket.entity.ts`, DTJ-278) — ТОЛЬКО подсказка UX (какие кнопки показать), не рубеж
 * защиты: реальная валидация перехода — сервер (`409 INVALID_TICKET_STATUS_TRANSITION`/
 * `TICKET_ALREADY_TERMINAL`, DTJ-282). Тот же принцип, что RBAC-кнопки: «скрываются на клиенте
 * для чистоты UX, не как единственный рубеж защиты» (DTJ-283 «Что сделать» п.5).
 */
import { useState, type ReactElement, type SyntheticEvent } from 'react'
import type { SupportTicketStatus } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useSupportTicketDetail } from '../api/use-support-ticket-detail'
import { useRespondTicket } from '../api/use-respond-ticket'
import { useChangeTicketStatus, type StatusTransition } from '../api/use-change-ticket-status'
import { SlaBadge } from './SlaBadge'

const TERMINAL_STATUS: SupportTicketStatus = 'closed'

const NEXT_STATUS_BY_CURRENT: Readonly<Record<SupportTicketStatus, readonly StatusTransition[]>> = {
  open: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
}

export interface SupportTicketDetailProps {
  readonly ticketId: string
}

export const SupportTicketDetail = ({ ticketId }: SupportTicketDetailProps): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const detailQuery = useSupportTicketDetail(ticketId)
  const respond = useRespondTicket(ticketId)
  const changeStatus = useChangeTicketStatus(ticketId)
  const [replyBody, setReplyBody] = useState('')

  if (detailQuery.isLoading) {
    return <p role="status">{t('admin.support.detail.loading')}</p>
  }
  if (detailQuery.error !== null || detailQuery.data === undefined) {
    return <p role="alert">{t('admin.support.detail.error')}</p>
  }

  const ticket = detailQuery.data
  const isTerminal = ticket.status === TERMINAL_STATUS
  const nextStatuses = NEXT_STATUS_BY_CURRENT[ticket.status]

  function handleReplySubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (replyBody.trim().length === 0) {
      return
    }
    respond.mutate(replyBody, { onSuccess: () => { setReplyBody('') } })
  }

  return (
    <section data-testid="support-ticket-detail">
      <h1>{t('admin.support.detail.title')}</h1>
      <dl>
        <dt>{t('admin.support.detail.category')}</dt>
        <dd>{t(`support.category.${ticket.category}`)}</dd>
        <dt>{t('admin.support.detail.channel')}</dt>
        <dd>{ticket.channel}</dd>
        <dt>{t('admin.support.detail.status')}</dt>
        <dd>{t(`support.status.${ticket.status}`)}</dd>
        {ticket.orderId !== null ? (
          <>
            <dt>{t('admin.support.detail.order')}</dt>
            <dd>{ticket.orderId}</dd>
          </>
        ) : null}
        {ticket.description !== null ? (
          <>
            <dt>{t('admin.support.detail.description')}</dt>
            <dd>{ticket.description}</dd>
          </>
        ) : null}
      </dl>
      <SlaBadge firstResponseDueAt={ticket.firstResponseDueAt} firstRespondedAt={ticket.firstRespondedAt} />
      <ul data-testid="support-ticket-messages">
        {ticket.messages.map((message) => (
          <li key={message.id}>
            <strong>{t(`admin.support.author_role.${message.authorRole}`)}</strong>: {message.body}
          </li>
        ))}
      </ul>
      <form onSubmit={handleReplySubmit} data-testid="support-ticket-reply-form">
        <label>
          {t('admin.support.detail.reply_label')}
          <textarea value={replyBody} onChange={(event) => { setReplyBody(event.target.value) }} />
        </label>
        <button type="submit" disabled={respond.isPending || replyBody.trim().length === 0}>
          {t('admin.support.detail.reply_submit')}
        </button>
        {respond.error !== null ? <p role="alert">{t('admin.support.detail.reply_error')}</p> : null}
      </form>
      {!isTerminal && nextStatuses.length > 0 ? (
        <div data-testid="support-ticket-status-actions">
          {nextStatuses.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => { changeStatus.mutate(status) }}
              disabled={changeStatus.isPending}
            >
              {t(`admin.support.status_action.${status}`)}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
