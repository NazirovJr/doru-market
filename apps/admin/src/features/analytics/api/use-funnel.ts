// GET /api/v1/analytics/funnel (DTJ-381) — форма запроса/ответа теперь единый источник `@dorutj/contracts` (правка CTO по ревью).
import { useMemo, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { FunnelConversionRatesDto, FunnelResponseDto, FunnelWeeklyTrendPointDto } from '@dorutj/contracts'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'

const FUNNEL_PATH = '/api/v1/analytics/funnel'
const MS_PER_DAY = 86_400_000
const DAYS_PER_WEEK = 7
const ISO_WEEK1_ANCHOR_DAY = 4
const PAD_LENGTH = 2

export type FunnelPeriodMode = 'week' | 'month'

export type FunnelData = FunnelResponseDto
export type { FunnelConversionRatesDto as FunnelConversionRates, FunnelWeeklyTrendPointDto as FunnelWeeklyTrendPoint }

function pad(value: number): string {
  return String(value).padStart(PAD_LENGTH, '0')
}

// ISO 8601 неделя (понедельник-старт) — независимая от `apps/api` реализация того же алгоритма (разные пакеты).
export function isoWeekOf(date: Date): { readonly year: number; readonly week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const isoWeekday = d.getUTCDay() === 0 ? DAYS_PER_WEEK : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + ISO_WEEK1_ANCHOR_DAY - isoWeekday)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / DAYS_PER_WEEK)
  return { year: d.getUTCFullYear(), week }
}

export function currentPeriod(mode: FunnelPeriodMode, now: Date = new Date()): string {
  if (mode === 'month') {
    return `${String(now.getUTCFullYear())}-${pad(now.getUTCMonth() + 1)}`
  }
  const { year, week } = isoWeekOf(now)
  return `${String(year)}-W${pad(week)}`
}

export async function fetchFunnel(tenantId: string, period: string): Promise<FunnelData> {
  return httpGetJson<FunnelData>(FUNNEL_PATH, { tenantId, period })
}

export function funnelQueryKey(tenantId: string, period: string): readonly unknown[] {
  return ['admin', 'analytics', 'funnel', tenantId, period] as const
}

export function useFunnel(tenantId: string | null, period: string): UseQueryResult<FunnelData, HttpError> {
  return useQuery<FunnelData, HttpError>({
    queryKey: funnelQueryKey(tenantId ?? '', period),
    queryFn: () => fetchFunnel(tenantId ?? '', period),
    enabled: tenantId !== null,
  })
}

export interface UseFunnelPeriodResult {
  readonly mode: FunnelPeriodMode
  readonly period: string
  readonly setMode: (mode: FunnelPeriodMode) => void
}

export function useFunnelPeriod(): UseFunnelPeriodResult {
  const [mode, setMode] = useState<FunnelPeriodMode>('month')
  const period = useMemo(() => currentPeriod(mode), [mode])
  return { mode, period, setMode }
}

export type { HttpError }
