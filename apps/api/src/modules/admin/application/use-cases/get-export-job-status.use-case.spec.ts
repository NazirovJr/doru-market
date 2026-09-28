import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import type { ExportJobsRepositoryPort, ExportJobView } from '../ports/report-export.port.js'
import { GetExportJobStatusUseCase } from './get-export-job-status.use-case.js'

function buildHarness(findByIdResult: ExportJobView | null) {
  const jobsRepository: ExportJobsRepositoryPort = {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(findByIdResult),
  }
  return { useCase: new GetExportJobStatusUseCase(jobsRepository), jobsRepository }
}

describe('GetExportJobStatusUseCase', () => {
  it('джоба найдена → возвращает view как есть', async () => {
    const view: ExportJobView = { id: 'job-1', status: 'ready', downloadUrl: 'file:///tmp/x.csv' }
    const { useCase } = buildHarness(view)

    await expect(useCase.execute({ exportJobId: 'job-1' })).resolves.toEqual(view)
  })

  it('джоба не найдена → NotFoundError (AC4)', async () => {
    const { useCase } = buildHarness(null)

    await expect(useCase.execute({ exportJobId: 'missing' })).rejects.toThrow(NotFoundError)
  })
})
