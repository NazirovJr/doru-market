// CommissionRatesPage (DTJ-358) — /admin/finance/commission-rates: список + форма добавления/редактирования ставок platform_fee.
import { useState, type ChangeEvent, type ReactElement, type SyntheticEvent } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { COMMISSION_CATEGORY_VALUES, type CommissionCategoryValue, type CommissionRateDto, type UpsertCommissionRateDto } from '@dorutj/contracts'
import { Button, Card, Input, Select, type SelectOption } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useCommissionRates, useUpsertCommissionRate, type CommissionRatesFilters } from '../api/use-commission-rates'

const EMPTY_FILTERS: CommissionRatesFilters = { tenantId: undefined, chainId: undefined, category: undefined }
const BPS_PER_PERCENT = 100
const PERCENT_FRACTION_DIGITS = 2

function rateBpsToPercentLabel(rateBps: number): string {
  return `${(rateBps / BPS_PER_PERCENT).toFixed(PERCENT_FRACTION_DIGITS)}%`
}

function percentDraftToRateBps(percentDraft: string): number | null {
  const percent = Number(percentDraft)
  if (!Number.isFinite(percent) || percent < 0) {
    return null
  }
  return Math.round(percent * BPS_PER_PERCENT)
}

interface FormDraft {
  readonly category: CommissionCategoryValue
  readonly rateBps: number
  readonly tenantId: string
  readonly chainId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string
}

interface FormInitialValues {
  readonly category: CommissionCategoryValue
  readonly tenantId: string
  readonly chainId: string
  readonly percentDraft: string
  readonly effectiveFrom: string
  readonly effectiveTo: string
}

const DEFAULT_FORM_VALUES: FormInitialValues = { category: 'rx', tenantId: '', chainId: '', percentDraft: '', effectiveFrom: '', effectiveTo: '' }

function resolveInitialFormValues(initial: CommissionRateDto | null): FormInitialValues {
  if (initial === null) {
    return DEFAULT_FORM_VALUES
  }
  return {
    category: initial.category ?? DEFAULT_FORM_VALUES.category,
    tenantId: initial.tenantId ?? DEFAULT_FORM_VALUES.tenantId,
    chainId: initial.chainId ?? DEFAULT_FORM_VALUES.chainId,
    percentDraft: String(initial.rateBps / BPS_PER_PERCENT),
    effectiveFrom: initial.effectiveFrom,
    effectiveTo: initial.effectiveTo ?? DEFAULT_FORM_VALUES.effectiveTo,
  }
}

function buildUpsertBody(draft: FormDraft): UpsertCommissionRateDto {
  return {
    category: draft.category,
    rateBps: draft.rateBps,
    effectiveFrom: draft.effectiveFrom,
    ...(draft.tenantId.trim() !== '' && { tenantId: draft.tenantId.trim() }),
    ...(draft.chainId.trim() !== '' && { chainId: draft.chainId.trim() }),
    ...(draft.effectiveTo.trim() !== '' && { effectiveTo: draft.effectiveTo.trim() }),
  }
}

export const CommissionRatesPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [filters, setFilters] = useState<CommissionRatesFilters>(EMPTY_FILTERS)
  const [categoryFilterDraft, setCategoryFilterDraft] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [editing, setEditing] = useState<CommissionRateDto | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const query = useCommissionRates(filters, cursor)
  const upsert = useUpsertCommissionRate()
  const items = query.data?.items ?? []
  const isFormOpen = isAdding || editing !== null

  function applyCategoryFilter(value: string): void {
    setCategoryFilterDraft(value)
    setCursor(null)
    setFilters((prev) => ({ ...prev, category: value === '' ? undefined : value }))
  }

  function handleSubmit(body: UpsertCommissionRateDto): void {
    upsert.mutate({ ...(editing !== null && { id: editing.id }), body })
    setIsAdding(false)
    setEditing(null)
  }

  const categoryFilterValue = categoryFilterDraft === '' ? null : categoryFilterDraft
  const nextCursor = query.data?.nextCursor ?? null

  return (
    <section data-testid="commission-rates-page">
      <h1>{t('admin.finance.commission_rates.title')}</h1>
      <CommissionRatesStatus isLoading={query.isLoading} hasError={query.error !== null} isEmpty={items.length === 0} t={t} />

      <Select
        label={t('admin.finance.commission_rates.filter.category')}
        value={categoryFilterValue}
        onChange={applyCategoryFilter}
        options={categoryOptions(t)}
        placeholder={t('admin.finance.commission_rates.filter.category_all')}
      />

      <Card>
        <CommissionRatesTable items={items} t={t} onEdit={(rate) => { setEditing(rate); setIsAdding(false) }} />
      </Card>
      <LoadMoreButton nextCursor={nextCursor} onLoadMore={() => { if (nextCursor !== null) setCursor(nextCursor) }} t={t} />

      <CommissionRateFormArea
        isFormOpen={isFormOpen}
        editing={editing}
        onSubmit={handleSubmit}
        onAdd={() => { setIsAdding(true) }}
        onCancel={() => { setIsAdding(false); setEditing(null) }}
        t={t}
      />
    </section>
  )
}

interface CommissionRatesStatusProps {
  readonly isLoading: boolean
  readonly hasError: boolean
  readonly isEmpty: boolean
  readonly t: TranslateFunction
}

const CommissionRatesStatus = ({ isLoading, hasError, isEmpty, t }: CommissionRatesStatusProps): ReactElement => {
  if (isLoading) {
    return <p role="status">{t('admin.finance.loading')}</p>
  }
  if (hasError) {
    return <p role="alert">{t('admin.finance.error')}</p>
  }
  if (isEmpty) {
    return <p>{t('admin.finance.commission_rates.empty')}</p>
  }
  return <></>
}

interface LoadMoreButtonProps {
  readonly nextCursor: string | null
  readonly onLoadMore: () => void
  readonly t: TranslateFunction
}

const LoadMoreButton = ({ nextCursor, onLoadMore, t }: LoadMoreButtonProps): ReactElement =>
  nextCursor === null ? (
    <></>
  ) : (
    <Button type="button" variant="secondary" size="md" onClick={onLoadMore}>
      {t('admin.finance.load_more')}
    </Button>
  )

interface CommissionRateFormAreaProps {
  readonly isFormOpen: boolean
  readonly editing: CommissionRateDto | null
  readonly onSubmit: (body: UpsertCommissionRateDto) => void
  readonly onAdd: () => void
  readonly onCancel: () => void
  readonly t: TranslateFunction
}

const CommissionRateFormArea = ({ isFormOpen, editing, onSubmit, onAdd, onCancel, t }: CommissionRateFormAreaProps): ReactElement => {
  if (!isFormOpen) {
    return (
      <Button type="button" variant="primary" size="md" onClick={onAdd}>
        {t('admin.finance.commission_rates.add_button')}
      </Button>
    )
  }
  return <CommissionRateForm initial={editing} onSubmit={onSubmit} onCancel={onCancel} t={t} />
}

function categoryOptions(t: TranslateFunction): readonly SelectOption[] {
  return COMMISSION_CATEGORY_VALUES.map((value) => ({ value, label: t(`admin.finance.commission_rates.category.${value}`) }))
}

interface CommissionRatesTableProps {
  readonly items: readonly CommissionRateDto[]
  readonly onEdit: (rate: CommissionRateDto) => void
  readonly t: TranslateFunction
}

const CommissionRatesTable = ({ items, onEdit, t }: CommissionRatesTableProps): ReactElement => (
  <table>
    <thead>
      <tr>
        <th>{t('admin.finance.commission_rates.column.tenant')}</th>
        <th>{t('admin.finance.commission_rates.column.chain')}</th>
        <th>{t('admin.finance.commission_rates.column.category')}</th>
        <th>{t('admin.finance.commission_rates.column.rate')}</th>
        <th>{t('admin.finance.commission_rates.column.effective_from')}</th>
        <th>{t('admin.finance.commission_rates.column.effective_to')}</th>
        <th>{t('admin.finance.commission_rates.column.actions')}</th>
      </tr>
    </thead>
    <tbody>
      {items.map((rate) => (
        <CommissionRateRow key={rate.id} rate={rate} onEdit={onEdit} t={t} />
      ))}
    </tbody>
  </table>
)

interface CommissionRateRowProps {
  readonly rate: CommissionRateDto
  readonly onEdit: (rate: CommissionRateDto) => void
  readonly t: TranslateFunction
}

const CommissionRateRow = ({ rate, onEdit, t }: CommissionRateRowProps): ReactElement => (
  <tr data-testid="commission-rate-row">
    <td>{rate.tenantId ?? t('admin.finance.commission_rates.global')}</td>
    <td>{rate.chainId ?? '—'}</td>
    <td>{rate.category === null ? '—' : t(`admin.finance.commission_rates.category.${rate.category}`)}</td>
    <td>{rateBpsToPercentLabel(rate.rateBps)}</td>
    <td>{rate.effectiveFrom}</td>
    <td>{rate.effectiveTo ?? t('admin.finance.commission_rates.no_end_date')}</td>
    <td>
      <Button type="button" variant="ghost" size="md" onClick={() => { onEdit(rate) }}>
        {t('admin.finance.commission_rates.edit_button')}
      </Button>
    </td>
  </tr>
)

interface CommissionRateFormProps {
  readonly initial: CommissionRateDto | null
  readonly onSubmit: (body: UpsertCommissionRateDto) => void
  readonly onCancel: () => void
  readonly t: TranslateFunction
}

const WARNING_BANNER_STYLE = {
  background: 'var(--brand-warning-bg)',
  border: '1px solid var(--brand-warning-border)',
  color: 'var(--brand-warning-text)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3) var(--space-4)',
  margin: '0 0 var(--space-4) 0',
} as const

const CommissionRateForm = ({ initial, onSubmit, onCancel, t }: CommissionRateFormProps): ReactElement => {
  const initialValues = resolveInitialFormValues(initial)
  const [category, setCategory] = useState<CommissionCategoryValue>(initialValues.category)
  const [tenantId, setTenantId] = useState(initialValues.tenantId)
  const [chainId, setChainId] = useState(initialValues.chainId)
  const [percentDraft, setPercentDraft] = useState(initialValues.percentDraft)
  const [effectiveFrom, setEffectiveFrom] = useState(initialValues.effectiveFrom)
  const [effectiveTo, setEffectiveTo] = useState(initialValues.effectiveTo)
  const [rateError, setRateError] = useState<string | undefined>(undefined)

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    const rateBps = percentDraftToRateBps(percentDraft)
    if (rateBps === null) {
      setRateError(t('admin.finance.commission_rates.form.rate_invalid'))
      return
    }
    onSubmit(buildUpsertBody({ category, rateBps, tenantId, chainId, effectiveFrom, effectiveTo }))
  }

  return (
    <form onSubmit={handleSubmit} data-testid="commission-rate-form">
      {/* Критерий приёмки 1 — предупреждение видно БЕЗ дополнительного действия, статичный текст, не тултип/модалка. */}
      <p role="note" style={WARNING_BANNER_STYLE} data-testid="commission-rate-not-retroactive-warning">
        {t('admin.finance.commission_rate_not_retroactive_warning')}
      </p>

      <Select label={t('admin.finance.commission_rates.form.category_label')} value={category} onChange={(value) => { setCategory(value as CommissionCategoryValue) }} options={categoryOptions(t)} />
      <Input label={t('admin.finance.commission_rates.form.tenant_id_label')} value={tenantId} onChange={(e: ChangeEvent<HTMLInputElement>) => { setTenantId(e.target.value) }} />
      <Input label={t('admin.finance.commission_rates.form.chain_id_label')} value={chainId} onChange={(e: ChangeEvent<HTMLInputElement>) => { setChainId(e.target.value) }} />
      <Input
        label={t('admin.finance.commission_rates.form.rate_label')}
        type="number"
        step="0.01"
        min={0}
        max={100}
        value={percentDraft}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setPercentDraft(e.target.value); setRateError(undefined) }}
        required
        {...(rateError !== undefined && { error: rateError })}
      />
      <Input label={t('admin.finance.commission_rates.form.effective_from_label')} type="date" value={effectiveFrom} onChange={(e: ChangeEvent<HTMLInputElement>) => { setEffectiveFrom(e.target.value) }} required />
      <Input label={t('admin.finance.commission_rates.form.effective_to_label')} type="date" value={effectiveTo} onChange={(e: ChangeEvent<HTMLInputElement>) => { setEffectiveTo(e.target.value) }} />

      <Button type="submit" variant="primary" size="md">
        {t('admin.finance.commission_rates.form.submit')}
      </Button>
      <Button type="button" variant="ghost" size="md" onClick={onCancel}>
        {t('admin.finance.commission_rates.form.cancel')}
      </Button>
    </form>
  )
}
