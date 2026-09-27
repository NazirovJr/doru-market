// Без дизайн-референса — те же идиомы, что funnel-page.tsx: нативная разметка, packages/ui пуст.
import { type ReactElement } from 'react'
import { useT, toIntlLocale, type TranslateFunction } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { getCurrentTenantId } from '@/shared/auth/current-role'
import { useFunnelPeriod, type FunnelPeriodMode } from '../api/use-funnel'
import { usePlatformMetrics, type PlatformMetricsData } from '../api/use-platform-metrics'

const DIRAM_PER_SOMONI = 100
const PERCENT_FRACTION_DIGITS = 0
const SOMONI_FRACTION_DIGITS = 2
const PERIOD_MODES: readonly FunnelPeriodMode[] = ['week', 'month']

// ASSUMPTION: порог вычислен из формулировки kill-критерия («менее 3 из 5-10»), не зафиксирован документом жёстко.
const ACTIVE_PHARMACIES_ALERT_THRESHOLD = 0.6

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

export const PlatformMetricsPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const tenantId = getCurrentTenantId()
  const { mode, period, setMode } = useFunnelPeriod()
  const query = usePlatformMetrics(tenantId, period)

  return (
    <section data-testid="platform-metrics-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{t('admin.platform_metrics.title')}</h1>
        <PeriodTabs mode={mode} onChange={setMode} t={t} />
      </div>
      {query.isLoading ? <p role="status">{t('admin.platform_metrics.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.platform_metrics.error')}</p> : null}
      {query.data !== undefined ? <MetricsGrid data={query.data} t={t} /> : null}
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
  <div data-testid="platform-metrics-period-tabs" role="tablist" style={{ display: 'flex', gap: 2 }}>
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

interface MetricsGridProps {
  readonly data: PlatformMetricsData
  readonly t: TranslateFunction
}

const MetricsGrid = ({ data, t }: MetricsGridProps): ReactElement => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginTop: 20 }}>
    <StatCard testId="platform-metrics-card-gmv" title={t('admin.platform_metrics.card.gmv.title')} value={t('admin.analytics_funnel.amount_somoni', { amount: formatSomoni(data.gmvDiram) })}>
      <div style={{ color: 'var(--ink-muted)' }}>
        {t('admin.platform_metrics.card.gmv.average_check', { amount: formatSomoni(data.averageCheckDiram) })}
      </div>
    </StatCard>
    <StatCard
      testId="platform-metrics-card-pickup-sla"
      title={t('admin.platform_metrics.card.pickup_sla.title')}
      value={formatPercent(data.pickupSlaComplianceRate)}
    />
    <StatCard
      testId="platform-metrics-card-delivery-sla"
      title={t('admin.platform_metrics.card.delivery_sla.title')}
      value={formatPercent(data.deliverySlaComplianceRate)}
    />
    <StatCard
      testId="platform-metrics-card-cancellation-rate"
      title={t('admin.platform_metrics.card.cancellation_rate.title')}
      value={formatPercent(data.cancellationRate)}
    />
    <ActivePharmaciesCard rate={data.activePharmaciesSendingDataRate} t={t} />
  </div>
)

interface StatCardProps {
  readonly testId: string
  readonly title: string
  readonly value: string
  readonly highlighted?: boolean
  readonly children?: ReactElement | null
}

const StatCard =({ testId, title, value, highlighted = false, children = null }: StatCardProps): ReactElement => (
  <div
    data-testid={testId}
    style={{
      border: highlighted ? '1.5px solid var(--brand-500)' : '1.5px solid var(--ink-muted)',
      borderRadius: 14,
      padding: 24,
      background: highlighted ? 'var(--brand-50)' : 'transparent',
    }}
  >
    <div>{title}</div>
    <div style={{ fontSize: 32, fontWeight: 800 }}>{value}</div>
    {children}
  </div>
)

interface ActivePharmaciesCardProps {
  readonly rate: number
  readonly t: TranslateFunction
}

// Единственная метрика экрана с прямой привязкой к решению «продолжать/останавливать пилот».
const ActivePharmaciesCard =({ rate, t }: ActivePharmaciesCardProps): ReactElement => {
  const isBelowThreshold = rate < ACTIVE_PHARMACIES_ALERT_THRESHOLD
  return (
    <StatCard testId="platform-metrics-card-active-pharmacies" title={t('admin.platform_metrics.card.active_pharmacies.title')} value={formatPercent(rate)} highlighted>
      {isBelowThreshold ? (
        <div
          data-testid="platform-metrics-active-pharmacies-badge-danger"
          style={{
            display: 'inline-block',
            marginTop: 8,
            padding: '4px 10px',
            borderRadius: 999,
            background: 'var(--color-status-danger-bg)',
            color: 'var(--color-status-danger-text)',
          }}
        >
          {t('admin.platform_metrics.card.active_pharmacies.below_threshold')}
        </div>
      ) : null}
    </StatCard>
  )
}
