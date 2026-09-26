// DTJ-384 — без дизайн-референса (та же оговорка, что platform-metrics-page.tsx/top-analogs-page.tsx).
import { type ReactElement } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { getCurrentTenantId } from '@/shared/auth/current-role'
import { useFunnelPeriod, type FunnelPeriodMode } from '../api/use-funnel'
import { useOnboardingFunnel, type OnboardingFunnelData } from '../api/use-onboarding-funnel'

const PERIOD_MODES: readonly FunnelPeriodMode[] = ['week', 'month']
const HOURS_FRACTION_DIGITS = 1
const DECISION_ORDER = ['approved', 'rejected'] as const

export const OnboardingFunnelPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const tenantId = getCurrentTenantId()
  const { mode, period, setMode } = useFunnelPeriod()
  const query = useOnboardingFunnel(tenantId, period)

  return (
    <section data-testid="onboarding-funnel-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{t('admin.onboarding_funnel.title')}</h1>
        <PeriodTabs mode={mode} onChange={setMode} t={t} />
      </div>
      {query.isLoading ? <p role="status">{t('admin.onboarding_funnel.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.onboarding_funnel.error')}</p> : null}
      {query.data !== undefined ? <OnboardingFunnelChart data={query.data} t={t} /> : null}
    </section>
  )
}

interface PeriodTabsProps {
  readonly mode: FunnelPeriodMode
  readonly onChange: (mode: FunnelPeriodMode) => void
  readonly t: TranslateFunction
}

// Переиспользует ключи периода funnel-page.tsx (тикет: «тот же Tabs-компонент, что funnel-page.tsx»).
const PeriodTabs = ({ mode, onChange, t }: PeriodTabsProps): ReactElement => (
  <div data-testid="onboarding-funnel-period-tabs" role="tablist" style={{ display: 'flex', gap: 2 }}>
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

interface OnboardingFunnelChartProps {
  readonly data: OnboardingFunnelData
  readonly t: TranslateFunction
}

const OnboardingFunnelChart = ({ data, t }: OnboardingFunnelChartProps): ReactElement => {
  if (data.length === 0) {
    return <p>{t('admin.onboarding_funnel.empty')}</p>
  }
  const byDecision = new Map(data.map((item) => [item.decision, item]))
  const maxHours = Math.max(...data.map((item) => item.averageDurationHours), 1)
  return (
    <div data-testid="onboarding-funnel-chart" style={{ display: 'flex', gap: 20, marginTop: 20 }}>
      {DECISION_ORDER.map((decision) => {
        const item = byDecision.get(decision)
        return (
          <div
            key={decision}
            data-testid={`onboarding-funnel-bar-${decision}`}
            style={{ flex: 1, border: '1.5px solid var(--ink-muted)', borderRadius: 14, padding: 24 }}
          >
            <div>{t(`admin.onboarding_funnel.decision.${decision}`)}</div>
            <div style={{ fontSize: 32, fontWeight: 800 }}>
              {item === undefined
                ? '—'
                : t('admin.onboarding_funnel.hours', { hours: item.averageDurationHours.toFixed(HOURS_FRACTION_DIGITS) })}
            </div>
            <div style={{ color: 'var(--ink-muted)' }}>
              {t('admin.onboarding_funnel.count', { count: item?.count ?? 0 })}
            </div>
            <div style={{ height: 14, borderRadius: 999, background: 'var(--brand-50)', overflow: 'hidden', marginTop: 8 }}>
              <div
                style={{
                  height: '100%',
                  borderRadius: 999,
                  background: 'var(--brand-500)',
                  width: `${String(((item?.averageDurationHours ?? 0) / maxHours) * 100)}%`,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
