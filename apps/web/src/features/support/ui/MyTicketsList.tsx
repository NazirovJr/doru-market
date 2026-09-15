/**
 * `MyTicketsList` (DTJ-284) — список СВОИХ обращений клиента: статус (локализованная подпись),
 * категория, дата. БЕЗ ленты переписки (сознательно исключено из R1-объёма этого тикета — полный
 * тред для клиента внутри `apps/web` технически уже возможен на API-уровне, `GET /:id`
 * DTJ-282, но не входит в этот тикет, см. «Риски» DTJ-284).
 *
 * **Гейт аутентификации** — тот же приём, что `checkout-screen.tsx` (DTJ-235): `GET /api/v1/
 * support-tickets` требует аутентифицированного актора (`AuthGuard`, DTJ-282) — без
 * `ProtectedRoute` в `apps/web/src/app/router.tsx` (не существует, проверено) этот экран сам
 * проверяет `useAuthStore().accessToken` и не шлёт запрос без него.
 */
import type { ReactElement } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import type { SupportTicketDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import { useMyTickets } from '../api/use-my-tickets'

const MyTicketsUnauthenticated = ({ t }: { readonly t: TranslateFunction }): ReactElement => (
  <p role="status" data-testid="my-tickets-unauthenticated" className="p-4 text-center text-sm text-ink-muted">
    {t('customer.support.unauthenticated')}
  </p>
)

const MyTicketsLoading = ({ t }: { readonly t: TranslateFunction }): ReactElement => (
  <p role="status" data-testid="my-tickets-loading" className="p-4 text-center text-sm text-ink-muted">
    {t('customer.support.list.loading')}
  </p>
)

const MyTicketsError = ({ t }: { readonly t: TranslateFunction }): ReactElement => (
  <p role="alert" data-testid="my-tickets-error" className="p-4 text-center text-sm text-brand-danger">
    {t('ux.error.generic_500')}
  </p>
)

const MyTicketsEmpty = ({ t }: { readonly t: TranslateFunction }): ReactElement => (
  <p data-testid="my-tickets-empty" className="p-4 text-center text-sm text-ink-muted">
    {t('customer.support.list.empty')}
  </p>
)

interface TicketRowProps {
  readonly ticket: SupportTicketDto
  readonly t: TranslateFunction
}

const TicketRow = ({ ticket, t }: TicketRowProps): ReactElement => (
  <li data-testid="my-ticket-row" className="flex items-center justify-between gap-2 rounded-md border border-line p-3">
    <span className="text-sm text-ink">{t(`support.category.${ticket.category}`)}</span>
    <span className="text-sm font-semibold text-ink-muted" data-testid="my-ticket-status">
      {t(`support.status.${ticket.status}`)}
    </span>
  </li>
)

export const MyTicketsList = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const accessToken = useAuthStore((state) => state.accessToken)
  const ticketsQuery = useMyTickets({ enabled: accessToken !== null })

  if (accessToken === null) {
    return <MyTicketsUnauthenticated t={t} />
  }
  if (ticketsQuery.isLoading) {
    return <MyTicketsLoading t={t} />
  }
  if (ticketsQuery.error !== null) {
    return <MyTicketsError t={t} />
  }
  const tickets = ticketsQuery.data ?? []
  if (tickets.length === 0) {
    return <MyTicketsEmpty t={t} />
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="my-tickets-list">
      {tickets.map((ticket) => (
        <TicketRow key={ticket.id} ticket={ticket} t={t} />
      ))}
    </ul>
  )
}
