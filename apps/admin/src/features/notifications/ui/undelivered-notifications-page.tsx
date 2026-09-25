// READ-ONLY диагностический экран — ни одного мутирующего действия, повторная отправка вне скоупа.
// packages/ui пуст — native table, тот же приём, что features/audit-log/ui/audit-log-page.tsx.
import { useEffect, useState, type ReactElement } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useUndeliveredNotifications, type UndeliveredNotificationDto } from '../api/use-undelivered-notifications'

export const UndeliveredNotificationsPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly UndeliveredNotificationDto[]>([])

  const query = useUndeliveredNotifications(cursor)

  useEffect(() => {
    if (query.data === undefined) return
    setItems((prev) => (cursor === null ? query.data.items : [...prev, ...query.data.items]))
  }, [query.data])

  function loadMore(): void {
    if (query.data?.nextCursor != null) {
      setCursor(query.data.nextCursor)
    }
  }

  return (
    <section data-testid="undelivered-notifications-page">
      <h1>{t('admin.undelivered_notifications.title')}</h1>
      <p>{t('admin.undelivered_notifications.description')}</p>
      {query.isLoading ? <p role="status">{t('admin.undelivered_notifications.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.undelivered_notifications.error')}</p> : null}
      <table>
        <thead>
          <tr>
            <th>{t('admin.undelivered_notifications.column.recipient')}</th>
            <th>{t('admin.undelivered_notifications.column.event')}</th>
            <th>{t('admin.undelivered_notifications.column.channels')}</th>
            <th>{t('admin.undelivered_notifications.column.last_attempt')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((group) => (
            <UndeliveredNotificationRow key={`${group.userId}:${group.sourceEventId}`} group={group} t={t} />
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.undelivered_notifications.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.undelivered_notifications.load_more')}
        </button>
      ) : null}
    </section>
  )
}

interface UndeliveredNotificationRowProps {
  readonly group: UndeliveredNotificationDto
  readonly t: TranslateFunction
}

const UndeliveredNotificationRow = ({ group, t }: UndeliveredNotificationRowProps): ReactElement => {
  return (
    <tr data-testid="undelivered-notifications-row">
      <td>{group.userId}</td>
      <td>{group.eventType}</td>
      <td>
        <ul>
          {group.attempts.map((attempt) => (
            <li key={attempt.channel}>
              {t(`admin.undelivered_notifications.channel.${attempt.channel}`)}
              {': '}
              {t(`admin.undelivered_notifications.status.${attempt.status}`)}
              {attempt.failedReason !== null ? ` — ${attempt.failedReason}` : ''}
            </li>
          ))}
        </ul>
      </td>
      <td>{new Date(group.lastAttemptAt).toLocaleString()}</td>
    </tr>
  )
}
