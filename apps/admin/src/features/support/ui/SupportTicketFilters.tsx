/**
 * `SupportTicketFilters` (DTJ-283) — панель фильтров очереди: статус/категория (server-side,
 * `use-support-tickets.ts`, синхронизированы с URL) + «только просроченные» (client-side,
 * `model/sla-status.ts`, см. её JSDoc). Ноль бизнес-логики — чистый рендер контролов.
 */
import type { ChangeEvent, ReactElement } from 'react'
import { SUPPORT_TICKET_CATEGORY_VALUES, SUPPORT_TICKET_STATUS_VALUES } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import type { SupportTicketsFilters } from '../api/use-support-tickets'

export interface SupportTicketFiltersProps {
  readonly filters: SupportTicketsFilters
  readonly onFilterChange: (key: keyof SupportTicketsFilters, value: string | undefined) => void
  readonly onlyOverdue: boolean
  readonly onOnlyOverdueChange: (value: boolean) => void
}

function toOptionalValue(event: ChangeEvent<HTMLSelectElement>): string | undefined {
  return event.target.value.length === 0 ? undefined : event.target.value
}

export const SupportTicketFilters = ({
  filters,
  onFilterChange,
  onlyOverdue,
  onOnlyOverdueChange,
}: SupportTicketFiltersProps): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  return (
    <div className="support-ticket-filters" data-testid="support-ticket-filters">
      <label>
        {t('admin.support.filters.status')}
        <select
          value={filters.status ?? ''}
          onChange={(event) => { onFilterChange('status', toOptionalValue(event)) }}
        >
          <option value="">{t('admin.support.filters.all')}</option>
          {SUPPORT_TICKET_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {t(`support.status.${status}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('admin.support.filters.category')}
        <select
          value={filters.category ?? ''}
          onChange={(event) => { onFilterChange('category', toOptionalValue(event)) }}
        >
          <option value="">{t('admin.support.filters.all')}</option>
          {SUPPORT_TICKET_CATEGORY_VALUES.map((category) => (
            <option key={category} value={category}>
              {t(`support.category.${category}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={onlyOverdue}
          onChange={(event) => { onOnlyOverdueChange(event.target.checked) }}
        />
        {t('admin.support.filters.only_overdue')}
      </label>
    </div>
  )
}
