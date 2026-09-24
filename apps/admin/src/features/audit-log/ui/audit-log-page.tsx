// packages/ui пуст — native table/select, замена одной правкой позже. metadata не маскируется
// повторно — уже замаскирована на уровне записи, страница только показывает JSON как есть.
import { useEffect, useState, type ChangeEvent, type ReactElement, type SyntheticEvent } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { AUDIT_LOG_CATEGORY_VALUES, type AuditLogCategory, type AuditLogEntryDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useAuditLog, useAuditLogFilters } from '../api/use-audit-log'

interface DraftFilters {
  readonly category: AuditLogCategory | ''
  readonly entityId: string
  readonly createdAtFrom: string
  readonly createdAtTo: string
}

const EMPTY_DRAFT: DraftFilters = { category: '', entityId: '', createdAtFrom: '', createdAtTo: '' }

export const AuditLogPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const { filters, setFilter, resetFilters } = useAuditLogFilters()
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_DRAFT)
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly AuditLogEntryDto[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const query = useAuditLog(filters, cursor)

  // смена фильтров сбрасывает накопленные страницы
  useEffect(() => {
    setCursor(null)
    setItems([])
  }, [filters])

  useEffect(() => {
    if (query.data === undefined) return
    setItems((prev) => (cursor === null ? query.data.items : [...prev, ...query.data.items]))
  }, [query.data])

  function applyFilters(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    setFilter('category', draft.category === '' ? undefined : draft.category)
    setFilter('entityId', draft.entityId.trim() === '' ? undefined : draft.entityId.trim())
    setFilter('createdAtFrom', draft.createdAtFrom === '' ? undefined : draft.createdAtFrom)
    setFilter('createdAtTo', draft.createdAtTo === '' ? undefined : draft.createdAtTo)
  }

  function handleReset(): void {
    setDraft(EMPTY_DRAFT)
    resetFilters()
  }

  function loadMore(): void {
    if (query.data?.nextCursor != null) {
      setCursor(query.data.nextCursor)
    }
  }

  return (
    <section data-testid="audit-log-page">
      <h1>{t('admin.audit_log.title')}</h1>
      <AuditLogFiltersForm draft={draft} onChange={setDraft} onSubmit={applyFilters} onReset={handleReset} t={t} />
      {query.isLoading ? <p role="status">{t('admin.audit_log.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.audit_log.error')}</p> : null}
      <table>
        <thead>
          <tr>
            <th>{t('admin.audit_log.column.created_at')}</th>
            <th>{t('admin.audit_log.column.category')}</th>
            <th>{t('admin.audit_log.column.entity')}</th>
            <th>{t('admin.audit_log.column.actor')}</th>
            <th>{t('admin.audit_log.column.action')}</th>
            <th>{t('admin.audit_log.column.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <AuditLogRow
              key={entry.id}
              entry={entry}
              isExpanded={expandedId === entry.id}
              onToggle={() => { setExpandedId((current) => (current === entry.id ? null : entry.id)) }}
              t={t}
            />
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.audit_log.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.audit_log.load_more')}
        </button>
      ) : null}
    </section>
  )
}

interface AuditLogFiltersFormProps {
  readonly draft: DraftFilters
  readonly onChange: (draft: DraftFilters) => void
  readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void
  readonly onReset: () => void
  readonly t: TranslateFunction
}

const AuditLogFiltersForm = ({ draft, onChange, onSubmit, onReset, t }: AuditLogFiltersFormProps): ReactElement => {
  return (
    <form onSubmit={onSubmit} data-testid="audit-log-filters">
      <label>
        {t('admin.audit_log.filter.category')}
        <select
          value={draft.category}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            onChange({ ...draft, category: e.target.value as AuditLogCategory | '' })
          }}
        >
          <option value="">{t('admin.audit_log.filter.category_all')}</option>
          {AUDIT_LOG_CATEGORY_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`admin.audit_log.category.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('admin.audit_log.filter.entity_id')}
        <input
          value={draft.entityId}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ ...draft, entityId: e.target.value }) }}
        />
      </label>
      <label>
        {t('admin.audit_log.filter.created_at_from')}
        <input
          type="date"
          value={draft.createdAtFrom}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ ...draft, createdAtFrom: e.target.value }) }}
        />
      </label>
      <label>
        {t('admin.audit_log.filter.created_at_to')}
        <input
          type="date"
          value={draft.createdAtTo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ ...draft, createdAtTo: e.target.value }) }}
        />
      </label>
      <button type="submit">{t('admin.audit_log.filter.apply')}</button>
      <button type="button" onClick={onReset}>
        {t('admin.audit_log.filter.reset')}
      </button>
    </form>
  )
}

interface AuditLogRowProps {
  readonly entry: AuditLogEntryDto
  readonly isExpanded: boolean
  readonly onToggle: () => void
  readonly t: TranslateFunction
}

const AuditLogRow = ({ entry, isExpanded, onToggle, t }: AuditLogRowProps): ReactElement => {
  return (
    <>
      <tr data-testid="audit-log-row" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td>{new Date(entry.createdAt).toLocaleString()}</td>
        <td>
          <span data-testid="audit-log-category-badge">{t(`admin.audit_log.category.${entry.category}`)}</span>
        </td>
        <td>
          {entry.entityType}:{entry.entityId}
        </td>
        <td>{entry.actorUserId ?? t('admin.audit_log.system_actor')}</td>
        <td>{entry.action}</td>
        <td>{entry.reason ?? '—'}</td>
      </tr>
      {isExpanded ? (
        <tr data-testid="audit-log-metadata-row">
          <td colSpan={6}>
            <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>
          </td>
        </tr>
      ) : null}
    </>
  )
}
