/** `GetExportJobStatusUseCase` (EP-15, DTJ-361, AC4) — 404 NOT_FOUND для неизвестного `exportJobId`. */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { EXPORT_JOBS_REPOSITORY, type ExportJobsRepositoryPort, type ExportJobView } from '../ports/report-export.port.js'

export interface GetExportJobStatusCommand {
  readonly exportJobId: string
}

@Injectable()
export class GetExportJobStatusUseCase {
  public constructor(@Inject(EXPORT_JOBS_REPOSITORY) private readonly jobsRepository: ExportJobsRepositoryPort) {}

  public async execute(command: GetExportJobStatusCommand): Promise<ExportJobView> {
    const job = await this.jobsRepository.findById(command.exportJobId)
    if (job === null) {
      throw new NotFoundError({ resource: 'export_job', exportJobId: command.exportJobId })
    }
    return job
  }
}
