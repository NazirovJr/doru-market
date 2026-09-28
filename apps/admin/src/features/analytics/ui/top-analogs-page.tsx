// DTJ-383 — без дизайн-референса (та же оговорка, что platform-metrics-page.tsx). Таблица, тот же приём, что audit-log-page.tsx.
import { type ReactElement } from 'react'
import { useT, toIntlLocale, type TranslateFunction } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { getCurrentTenantId } from '@/shared/auth/current-role'
import { ReportExportButton } from '@/shared/ui/report-export-button'
import { useFunnelPeriod, type FunnelPeriodMode } from '../api/use-funnel'
import { useTopAnalogs, type TopAnalogsData } from '../api/use-top-analogs'

const DAYS_PER_MONTH_APPROX = 30
const DAYS_PER_WEEK = 7

// week/month ≤31 дня — экспорт всегда синхронный.
function periodModeToDays(mode: FunnelPeriodMode): number {
  return mode === 'week' ? DAYS_PER_WEEK : DAYS_PER_MONTH_APPROX
}

const DIRAM_PER_SOMONI = 100
const PERCENT_FRACTION_DIGITS = 0
const SOMONI_FRACTION_DIGITS = 2
const PERIOD_MODES: readonly FunnelPeriodMode[] = ['week', 'month']
const CONVERSION_HIGH_THRESHOLD = 0.15
const CONVERSION_LOW_THRESHOLD = 0.05

function formatSomoni(diram: number): string {
  return new Intl.NumberFormat(toIntlLocale(ADMIN_LOCALE), { maximumFractionDigits: SOMONI_FRACTION_DIGITS }).format(
    diram / DIRAM_PER_SOMONI,
  )
}

function formatPercent(rate: number): string {
  return new Intl.NumberFormat(toIntlLocale(ADMIN_LOCALE), {
    style: 'percent',
    maximumFractionDigits: PERCENT_FRACTION_DIGITS,
  }).format(rate)
}

export const TopAnalogsPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const tenantId = getCurrentTenantId()
  const { mode, period, setMode } = useFunnelPeriod()
  const query = useTopAnalogs(tenantId, period)

  return (
    <section data-testid="top-analogs-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{t('admin.top_analogs.title')}</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <PeriodTabs mode={mode} onChange={setMode} t={t} />
          <ReportExportButton
            reportType="top-analogs"
            periodDays={periodModeToDays(mode)}
            params={{ tenantId: tenantId ?? '', period }}
            rows={(query.data ?? []) as unknown as readonly Record<string, unknown>[]}
            columns={[
              { key: 'medicineName', header: t('admin.top_analogs.column.medicine') },
              { key: 'avgSavingsDiram', header: t('admin.top_analogs.column.avg_savings') },
              { key: 'timesShown', header: t('admin.top_analogs.column.times_shown') },
              { key: 'conversionToOrder', header: t('admin.top_analogs.column.conversion') },
            ]}
            fileBaseName="top-analogs"
          />
        </div>
      </div>
      {query.isLoading ? <p role="status">{t('admin.top_analogs.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.top_analogs.error')}</p> : null}
      {query.data !== undefined ? <TopAnalogsTable data={query.data} t={t} /> : null}
    </section>
  )
}

interface PeriodTabsProps {
  readonly mode: FunnelPeriodMode
  readonly onChange: (mode: FunnelPeriodMode) => void
  readonly t: TranslateFunction
}

// Переиспользует ключи периода funnel-page.tsx — период недели/месяца не специфичен экрану.
const PeriodTabs = ({ mode, onChange, t }: PeriodTabsProps): ReactElement => (
  <div data-testid="top-analogs-period-tabs" role="tablist" style={{ display: 'flex', gap: 2 }}>
    {PERIOD_MODES.map((candidate) => (
      <button
        key={candidate}
        type="button"
        role="tab"
        aria-selected={candidate === mode}
        onClick={() => { onChange(candidate) }}
        style={{
          background: candidate === mode ? 'var(--brand-500)' : 'transparent',
          color: candidate === mode ? 'var(--brand-on-primary)' : 'var(--ink-muted)',
          border: 'none',
          borderRadius: 6,
          padding: '8px 16px',
          cursor: 'pointer',
        }}
      >
        {t(`admin.analytics_funnel.period.${candidate}`)}
      </button>
    ))}
  </div>
)

interface TopAnalogsTableProps {
  readonly data: TopAnalogsData
  readonly t: TranslateFunction
}

// Дефолт-сортировка timesShown:desc — контракт бэкенда (ORDER BY COUNT(*) DESC), фронт не пересортировывает.
const TopAnalogsTable = ({ data, t }: TopAnalogsTableProps): ReactElement => {
  if (data.length === 0) {
    return <p>{t('admin.top_analogs.empty')}</p>
  }
  return (
    <table data-testid="top-analogs-table">
      <thead>
        <tr>
          <th>{t('admin.top_analogs.column.medicine')}</th>
          <th>{t('admin.top_analogs.column.avg_savings')}</th>
          <th>{t('admin.top_analogs.column.times_shown')}</th>
          <th>{t('admin.top_analogs.column.conversion')}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((item) => (
          <tr key={item.medicineId} data-testid="top-analogs-row">
            <td>{item.medicineName}</td>
            <td>{t('admin.analytics_funnel.amount_somoni', { amount: formatSomoni(item.avgSavingsDiram) })}</td>
            <td>{item.timesShown}</td>
            <td>
              <ConversionBadge rate={item.conversionToOrder} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const ConversionBadge = ({ rate }: { readonly rate: number }): ReactElement => {
  const tone =
    rate >= CONVERSION_HIGH_THRESHOLD ? 'success' : rate >= CONVERSION_LOW_THRESHOLD ? 'warning' : 'danger'
  const colors: Readonly<Record<string, { readonly bg: string; readonly text: string }>> = {
    success: { bg: 'var(--color-status-success-bg)', text: 'var(--color-status-success-text)' },
    warning: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
    danger: { bg: 'var(--color-status-danger-bg)', text: 'var(--color-status-danger-text)' },
  }
  const palette = colors[tone]
  return (
    <span
      data-testid="top-analogs-conversion-badge"
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        background: palette?.bg,
        color: palette?.text,
      }}
    >
      {formatPercent(rate)}
    </span>
  )
}
