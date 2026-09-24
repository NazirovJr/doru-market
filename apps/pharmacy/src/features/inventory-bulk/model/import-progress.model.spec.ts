import { describe, expect, it } from 'vitest'
import { computeAggregateProgress } from './import-progress.model'

describe('computeAggregateProgress', () => {
  it('2 из 3 завершённых батчей даёт percent≈66.67, isComplete=false', () => {
    const result = computeAggregateProgress([
      { status: 'completed_full_success' },
      { status: 'completed_full_success' },
      { status: 'processing' },
    ])
    expect(result.percent).toBeCloseTo(66.67, 1)
    expect(result.isComplete).toBe(false)
  })

  it('все батчи терминальны даёт isComplete=true', () => {
    const result = computeAggregateProgress([
      { status: 'completed_full_success' },
      { status: 'completed_partial_success' },
      { status: 'failed_validation' },
    ])
    expect(result.isComplete).toBe(true)
    expect(result.percent).toBe(100)
  })

  it('хотя бы один completed_partial_success/failed_validation даёт hasErrors=true', () => {
    expect(computeAggregateProgress([{ status: 'completed_partial_success' }]).hasErrors).toBe(true)
    expect(computeAggregateProgress([{ status: 'failed_validation' }]).hasErrors).toBe(true)
    expect(computeAggregateProgress([{ status: 'completed_full_success' }]).hasErrors).toBe(false)
  })

  it('0 батчей (граничный случай) не делит на ноль', () => {
    const result = computeAggregateProgress([])
    expect(result).toEqual({ percent: 0, isComplete: false, hasErrors: false })
  })

  it('очередь/обработка (queued/processing) не считаются завершёнными', () => {
    const result = computeAggregateProgress([{ status: 'queued' }, { status: 'processing' }])
    expect(result.percent).toBe(0)
    expect(result.isComplete).toBe(false)
    expect(result.hasErrors).toBe(false)
  })
})
