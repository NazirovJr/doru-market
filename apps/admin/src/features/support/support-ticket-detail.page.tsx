/**
 * `SupportTicketDetailPage` (DTJ-283) — экран `/admin/support-tickets/:id`. Тонкая композиция
 * `SupportTicketDetail`, ноль бизнес-логики — тот же приём, что `onboarding-application-detail.
 * page.tsx` (DTJ-075): `:id` читается `useParams()` на этом уровне, `SupportTicketDetail` сам по
 * себе параметром маршрута не интересуется (переиспользуем компонент вне контекста роутера, если
 * понадобится — напр. будущий предпросмотр в модалке).
 */
import type { ReactElement } from 'react'
import { useParams } from 'react-router'
import { SupportTicketDetail } from './ui/SupportTicketDetail'

export const SupportTicketDetailPage = (): ReactElement => {
  const params = useParams<{ id?: string }>()
  const ticketId = params.id ?? ''
  return <SupportTicketDetail ticketId={ticketId} />
}
