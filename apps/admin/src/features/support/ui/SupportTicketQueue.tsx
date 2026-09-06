/**
 * `SupportTicketQueue` (DTJ-283) — таблица/список карточек тикетов, сортировка по умолчанию:
 * просроченные + высокий приоритет первыми (`model/sla-status.ts#compareByUrgency`, АС1 тикета).
 */
import { useMemo, useState, type ReactElement } from 'react'
import { Link } from 'react-router'
import { useT } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useSupportTickets } from '../api/use-support-tickets'
import { compareByUrgency, isOverdue } from '../model/sla-status'
import { SlaBadge } from './SlaBadge'
import { SupportTicketFilters } from './SupportTicketFilters'

export const SupportTicketQueue = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const { query, filters, setFilter } = useSupportTickets()
  const [onlyOverdue, setOnlyOverdue] = useState(false)

  const sortedItems = useMemo(() => {
    const items = query.data ?? []
    const filtered = onlyOverdue ? items.filter((ticket) => isOverdue(ticket)) : items
    return [...filtered].sort((a, b) => compareByUrgency(a, b))
  }, [query.data, onlyOverdue])

  return (
    <section data-testid="support-ticket-queue">
      <h1>{t('admin.support.queue.title')}</h1>
      <SupportTicketFilters
        filters={filters}
        onFilterChange={setFilter}
        onlyOverdue={onlyOverdue}
        onOnlyOverdueChange={setOnlyOverdue}
      />
      {query.isLoading ? <p role="status">{t('admin.support.queue.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.support.queue.error')}</p> : null}
      {!query.isLoading && query.error === null && sortedItems.length === 0 ? <p>{t('admin.support.queue.empty')}</p> : null}
      <ul>
        {sortedItems.map((ticket) => (
          <li key={ticket.id} data-testid="support-ticket-row" data-ticket-id={ticket.id}>
            <Link to={`/admin/support-tickets/${ticket.id}`}>
              {t(`support.category.${ticket.category}`)} — {t(`support.status.${ticket.status}`)}
            </Link>
            <SlaBadge firstResponseDueAt={ticket.firstResponseDueAt} firstRespondedAt={ticket.firstRespondedAt} />
          </li>
        ))}
      </ul>
    </section>
  )
}
