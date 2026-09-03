/**
 * Unit-тесты `EscrowLedgerImbalanceMetric` (EP-10, DTJ-247). См. JSDoc класса — этот процесс
 * (`apps/api`) НЕ инкрементирует данный экземпляр напрямую (джоба живёт в `apps/worker`,
 * отдельный процесс) — тесты проверяют примитив как есть: инкремент/значение/условный экспорт.
 */
import { describe, expect, it } from 'vitest'
import { EscrowLedgerImbalanceMetric } from './escrow-ledger-imbalance.metric.js'

describe('EscrowLedgerImbalanceMetric (DTJ-247)', () => {
  it('стартует с нуля', () => {
    const metric = new EscrowLedgerImbalanceMetric(true)
    expect(metric.value).toBe(0)
  })

  it('increment() увеличивает счётчик на 1 за вызов', () => {
    const metric = new EscrowLedgerImbalanceMetric(true)
    metric.increment()
    metric.increment()
    metric.increment()
    expect(metric.value).toBe(3)
  })

  it('toPrometheusText() возвращает exposition-формат, когда экспорт включён', () => {
    const metric = new EscrowLedgerImbalanceMetric(true)
    metric.increment()
    metric.increment()
    const text = metric.toPrometheusText()
    expect(text).toContain('escrow_ledger_imbalance_count')
    expect(text).toContain('# TYPE escrow_ledger_imbalance_count counter')
    expect(text).toMatch(/escrow_ledger_imbalance_count 2\n?$/u)
  })

  it('toPrometheusText() возвращает null, когда экспорт выключен ENV-флагом', () => {
    const metric = new EscrowLedgerImbalanceMetric(false)
    metric.increment()
    expect(metric.toPrometheusText()).toBeNull()
  })
})
