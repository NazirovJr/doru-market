import { describe, expect, it, vi } from 'vitest'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import type { ExportJobsRepositoryPort, ReportExportQueuePort, ReportExportRendererPort } from '../ports/report-export.port.js'
import { RequestReportExportDeps, RequestReportExportUseCase } from './request-report-export.use-case.js'

const FIXED_NOW = new Date('2026-09-27T10:00:00.000Z')

function buildHarness() {
  const renderSyncMock = vi.fn<ReportExportRendererPort['renderSync']>().mockResolvedValue(Buffer.from('csv-content'))
  const enqueueMock = vi.fn<ReportExportQueuePort['enqueue']>().mockResolvedValue(undefined)
  const createMock = vi.fn<ExportJobsRepositoryPort['create']>().mockResolvedValue(undefined)
  const renderer: ReportExportRendererPort = { renderSync: renderSyncMock }
  const queue: ReportExportQueuePort = { enqueue: enqueueMock }
  const jobsRepository: ExportJobsRepositoryPort = { create: createMock, findById: vi.fn() }
  const clock: Clock = { now: () => FIXED_NOW }
  const idGenerator: IdGenerator = { next: () => 'export-job-1' }
  const useCase = new RequestReportExportUseCase(new RequestReportExportDeps(renderer, queue, jobsRepository), clock, idGenerator)
  return { useCase, renderSyncMock, enqueueMock, createMock }
}

describe('RequestReportExportUseCase', () => {
  it('periodDays <= 31 → синхронная ветка, renderSync вызван, export_jobs НЕ создан (AC1)', async () => {
    const { useCase, renderSyncMock, createMock, enqueueMock } = buildHarness()

    const result = await useCase.execute({
      reportType: 'top-analogs',
      periodDays: 20,
      format: 'csv',
      params: {},
      rows: [{ a: 1 }],
      columns: [{ key: 'a', header: 'A' }],
      actorUserId: 'user-1',
    })

    expect(result).toEqual({ kind: 'sync', buffer: Buffer.from('csv-content') })
    expect(renderSyncMock).toHaveBeenCalledWith([{ a: 1 }], [{ key: 'a', header: 'A' }], 'csv')
    expect(createMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('periodDays > 31 → export_jobs создан НЕМЕДЛЕННО, до постановки в очередь (AC2)', async () => {
    const { useCase, createMock, enqueueMock } = buildHarness()
    const calls: string[] = []
    createMock.mockImplementation(() => {
      calls.push('create')
      return Promise.resolve()
    })
    enqueueMock.mockImplementation(() => {
      calls.push('enqueue')
      return Promise.resolve()
    })

    const result = await useCase.execute({
      reportType: 'pharmacy-sales',
      periodDays: 45,
      format: 'csv',
      params: { pharmacyId: 'ph-1' },
      actorUserId: 'user-1',
    })

    expect(result).toEqual({ kind: 'async', exportJobId: 'export-job-1' })
    expect(calls).toEqual(['create', 'enqueue'])
    expect(createMock).toHaveBeenCalledWith({
      id: 'export-job-1',
      reportType: 'pharmacy-sales',
      params: { pharmacyId: 'ph-1' },
      format: 'csv',
      requestedBy: 'user-1',
      createdAt: FIXED_NOW,
    })
    expect(enqueueMock).toHaveBeenCalledWith({
      exportJobId: 'export-job-1',
      reportType: 'pharmacy-sales',
      params: { pharmacyId: 'ph-1' },
      format: 'csv',
    })
  })

  it('синхронная ветка без rows/columns → ValidationError', async () => {
    const { useCase } = buildHarness()

    await expect(
      useCase.execute({ reportType: 'top-analogs', periodDays: 10, format: 'csv', params: {}, actorUserId: null }),
    ).rejects.toThrow(/rows\/columns/)
  })
})
