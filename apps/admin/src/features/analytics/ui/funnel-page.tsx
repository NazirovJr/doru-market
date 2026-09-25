// DTJ-381, дизайн-референс `32-design-reference.md` §«Аналитика». `packages/ui` пуст (тот же приём, что `audit-log-page.tsx`) — нативная разметка, цвета из существующих CSS-переменных `apps/admin/index.html`.
import { type ReactElement } from 'react'
import { useT, toIntlLocale, type TranslateFunction } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { getCurrentTenantId } from '@/shared/auth/current-role'
import {
  useFunnel,
  useFunnelPeriod,
  type FunnelData,
  type FunnelPeriodMode,
  type FunnelWeeklyTrendPoint,
} from '../api/use-funnel'

const DIRAM_PER_SOMONI = 100
const PERCENT_FRACTION_DIGITS = 0
const SOMONI_FRACTION_DIGITS = 2
const PERIOD_MODES: readonly FunnelPeriodMode[] = ['week', 'month']

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

function formatWeekLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return isoDate
  }
  return new Intl.DateTimeFormat(toIntlLocale(ADMIN_LOCALE), { day: '2-digit', month: '2-digit' }).format(parsed)
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export const FunnelPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const tenantId = getCurrentTenantId()
  const { mode, period, setMode } = useFunnelPeriod()
  const query = useFunnel(tenantId, period)

  return (
    <section data-testid="funnel-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{t('admin.analytics_funnel.title')}</h1>
        <PeriodTabs mode={mode} onChange={setMode} t={t} />
      </div>
      {query.isLoading ? <p role="status">{t('admin.analytics_funnel.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.analytics_funnel.error')}</p> : null}
      {query.data !== undefined ? <FunnelContent data={query.data} t={t} /> : null}
    </section>
  )
}

interface PeriodTabsProps {
  readonly mode: FunnelPeriodMode
  readonly onChange: (mode: FunnelPeriodMode) => void
  readonly t: TranslateFunction
}

const PeriodTabs = ({ mode, onChange, t }: PeriodTabsProps): ReactElement => (
  <div data-testid="funnel-period-tabs" role="tablist" style={{ display: 'flex', gap: 2 }}>
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

interface FunnelContentProps {
  readonly data: FunnelData
  readonly t: TranslateFunction
}

const FunnelContent = ({ data, t }: FunnelContentProps): ReactElement => {
  const realizedPercent = safeDivide(data.totalSavingsRealizedDiram, data.totalSavingsShownDiram)
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div data-testid="funnel-hero-shown" style={{ border: '1.5px solid var(--ink-muted)', borderRadius: 14, padding: 24 }}>
          <div>{t('admin.analytics_funnel.hero.shown_title')}</div>
          <div style={{ fontSize: 36, fontWeight: 800 }}>{t('admin.analytics_funnel.amount_somoni', { amount: formatSomoni(data.totalSavingsShownDiram) })}</div>
        </div>
        <div
          data-testid="funnel-hero-realized"
          style={{
            border: '1.5px solid var(--color-status-success-text)',
            borderRadius: 14,
            padding: 24,
            background: 'var(--color-status-success-bg)',
          }}
        >
          <div style={{ color: 'var(--color-status-success-text)' }}>{t('admin.analytics_funnel.hero.realized_title')}</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--color-status-success-text)' }}>
            {t('admin.analytics_funnel.amount_somoni', { amount: formatSomoni(data.totalSavingsRealizedDiram) })}
          </div>
          <div style={{ color: 'var(--color-status-success-text)' }}>
            {t('admin.analytics_funnel.hero.realized_percent', { percent: formatPercent(realizedPercent) })}
          </div>
        </div>
      </div>
      <FunnelSteps data={data} t={t} />
      <TrendChart weeklyTrend={data.weeklyTrend} t={t} />
    </>
  )
}

type FunnelStepKey = 'analog_shown' | 'analog_clicked' | 'added_to_cart' | 'order_placed'

interface FunnelStepRow {
  readonly key: FunnelStepKey
  readonly value: number
  readonly conversion: number | null
}

function buildStepRows(data: FunnelData): readonly FunnelStepRow[] {
  return [
    { key: 'analog_shown', value: data.analogShown, conversion: null },
    { key: 'analog_clicked', value: data.analogClicked, conversion: data.conversionRates.shownToClicked },
    { key: 'added_to_cart', value: data.addedToCart, conversion: data.conversionRates.clickedToCart },
    { key: 'order_placed', value: data.orderPlaced, conversion: data.conversionRates.cartToOrder },
  ]
}

const FunnelSteps = ({ data, t }: FunnelContentProps): ReactElement => {
  const rows = buildStepRows(data)
  const maxValue = Math.max(...rows.map((row) => row.value), 1)
  return (
    <div data-testid="funnel-steps" style={{ border: '1.5px solid var(--ink-muted)', borderRadius: 14, padding: 28 }}>
      <div>{t('admin.analytics_funnel.funnel.title')}</div>
      {rows.map((row) => (
        <div key={row.key} data-testid="funnel-step-row">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{t(`admin.analytics_funnel.step.${row.key}`)}</span>
            <span>
              {row.value}
              {row.conversion !== null ? ` · ${t('admin.analytics_funnel.conversion_from_previous', { percent: formatPercent(row.conversion) })}` : ''}
            </span>
          </div>
          <div style={{ height: 14, borderRadius: 999, background: 'var(--brand-50)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                borderRadius: 999,
                background: 'var(--brand-500)',
                width: `${String((row.value / maxValue) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

interface TrendChartProps {
  readonly weeklyTrend: readonly FunnelWeeklyTrendPoint[]
  readonly t: TranslateFunction
}

const TrendChart = ({ weeklyTrend, t }: TrendChartProps): ReactElement => {
  const maxValue = Math.max(...weeklyTrend.map((point) => point.realizedSavingsDiram), 1)
  return (
    <div data-testid="funnel-trend" style={{ border: '1.5px solid var(--ink-muted)', borderRadius: 14, padding: 28 }}>
      <div>{t('admin.analytics_funnel.trend.title')}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 120 }}>
        {weeklyTrend.map((point) => (
          <div key={point.weekLabel} data-testid="funnel-trend-bar" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
            <div
              style={{
                width: '100%',
                maxWidth: 36,
                borderRadius: '6px 6px 0 0',
                background: 'var(--brand-500)',
                height: `${String((point.realizedSavingsDiram / maxValue) * 100)}%`,
              }}
            />
            <span>{formatWeekLabel(point.weekLabel)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
