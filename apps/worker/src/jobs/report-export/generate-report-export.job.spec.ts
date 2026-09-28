import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { ReportExportJobData } from '@dorutj/contracts'
import { GenerateReportExportJob } from './generate-report-export.job.js'
import type { ReportExportDataBuilderPort } from './report-export-data-builder.port.js'
import type { ReportExportStorePort } from './report-export-store.port.js'

const writeFileMock = vi.fn<(path: string, buffer: Buffer) => Promise<void>>().mockResolvedValue(undefined)
const mkdirMock = vi.fn<(path: string, options?: unknown) => Promise<void>>().mockResolvedValue(undefined)

vi.mock('node:fs/promises', () => ({
  writeFile: (path: string, buffer: Buffer) => writeFileMock(path, buffer),
  mkdir: (path: string, options?: unknown) => mkdirMock(path, options),
}))

const JOB_DATA: ReportExportJobData = {
  exportJobId: 'export-job-1',
  reportType: 'top-analogs',
  params: { period: '2026-09' },
  format: 'csv',
}

function buildJob(overrides: Partial<ReportExportJobData> = {}): Job<ReportExportJobData> {
  return { data: { ...JOB_DATA, ...overrides } } as Job<ReportExportJobData>
}

function buildHarness() {
  const buildMock = vi.fn<ReportExportDataBuilderPort['build']>().mockResolvedValue({ rows: [{ a: 1 }], columns: [{ key: 'a', header: 'A' }] })
  const markReadyMock = vi.fn<ReportExportStorePort['markReady']>()
  const markFailedMock = vi.fn<ReportExportStorePort['markFailed']>()
  const dataBuilder: ReportExportDataBuilderPort = { build: buildMock }
  const store: ReportExportStorePort = { markReady: markReadyMock, markFailed: markFailedMock }
  const job = new GenerateReportExportJob(dataBuilder, store)
  return { job, buildMock, markReadyMock, markFailedMock }
}

describe('GenerateReportExportJob', () => {
  beforeEach(() => {
    writeFileMock.mockClear()
    mkdirMock.mockClear()
  })

  it('успешный прогон → загружает в хранилище по детерминированному ключу, помечает ready', async () => {
    const { job, markReadyMock } = buildHarness()
    markReadyMock.mockResolvedValue(undefined)

    await job.process(buildJob())

    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [writtenPath] = writeFileMock.mock.calls[0] as [string, Buffer]
    expect(writtenPath).toContain('report-exports')
    expect(writtenPath).toContain('export-job-1.csv')
    expect(markReadyMock).toHaveBeenCalledWith('export-job-1', expect.stringContaining('export-job-1.csv'), expect.any(Date))
  })

  it('AC3: markReady падает на первой попытке (симуляция краха ПОСЛЕ загрузки в MinIO, ДО UPDATE) — ретрай перезаписывает ТОТ ЖЕ ключ и завершается успешно', async () => {
    const { job, markReadyMock, markFailedMock } = buildHarness()
    markReadyMock.mockRejectedValueOnce(new Error('crash before UPDATE')).mockResolvedValueOnce(undefined)
    markFailedMock.mockResolvedValue(undefined)

    await expect(job.process(buildJob())).rejects.toThrow('crash before UPDATE')
    expect(markFailedMock).toHaveBeenCalledTimes(1)

    // BullMQ ретраит — та же джоба вызывается повторно.
    await job.process(buildJob())

    expect(writeFileMock).toHaveBeenCalledTimes(2)
    const firstPath = (writeFileMock.mock.calls[0] as [string, Buffer])[0]
    const secondPath = (writeFileMock.mock.calls[1] as [string, Buffer])[0]
    expect(secondPath).toBe(firstPath)
    expect(markReadyMock).toHaveBeenCalledTimes(2)
  })

  it('format=xlsx (не реализован в apps/worker) → markFailed, ошибка пробрасывается', async () => {
    const { job, buildMock, markFailedMock } = buildHarness()
    markFailedMock.mockResolvedValue(undefined)

    await expect(job.process(buildJob({ format: 'xlsx' }))).rejects.toThrow(/xlsx/)
    expect(buildMock).not.toHaveBeenCalled()
    expect(markFailedMock).toHaveBeenCalledTimes(1)
  })
})
