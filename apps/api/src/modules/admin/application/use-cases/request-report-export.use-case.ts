// export_jobs создаётся ДО постановки в очередь — запись видна немедленно, не после завершения джобы (AC2).
import { Inject, Injectable } from '@nestjs/common'
import { ValidationError, isSyncExportPeriod, type ReportExportFormat } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import {
  EXPORT_JOBS_REPOSITORY,
  REPORT_EXPORT_QUEUE,
  REPORT_EXPORT_RENDERER,
  type ColumnDef,
  type ExportJobsRepositoryPort,
  type ReportExportQueuePort,
  type ReportExportRendererPort,
} from '../ports/report-export.port.js'

export interface RequestReportExportCommand {
  readonly reportType: string
  readonly periodDays: number
  readonly format: ReportExportFormat
  readonly params: Readonly<Record<string, unknown>>
  readonly rows?: readonly Record<string, unknown>[]
  readonly columns?: readonly ColumnDef[]
  readonly actorUserId: string | null
}

export type RequestReportExportResult =
  | { readonly kind: 'sync'; readonly buffer: Buffer }
  | { readonly kind: 'async'; readonly exportJobId: string }

// Агрегирует 3 порта в один параметр — иначе конструктор нёс бы 5, max-params ≤3.
@Injectable()
export class RequestReportExportDeps {
  public constructor(
    @Inject(REPORT_EXPORT_RENDERER) public readonly renderer: ReportExportRendererPort,
    @Inject(REPORT_EXPORT_QUEUE) public readonly queue: ReportExportQueuePort,
    @Inject(EXPORT_JOBS_REPOSITORY) public readonly jobsRepository: ExportJobsRepositoryPort,
  ) {}
}

@Injectable()
export class RequestReportExportUseCase {
  private readonly renderer: ReportExportRendererPort
  private readonly queue: ReportExportQueuePort
  private readonly jobsRepository: ExportJobsRepositoryPort

  public constructor(
    @Inject(RequestReportExportDeps) deps: RequestReportExportDeps,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {
    this.renderer = deps.renderer
    this.queue = deps.queue
    this.jobsRepository = deps.jobsRepository
  }

  public async execute(command: RequestReportExportCommand): Promise<RequestReportExportResult> {
    if (isSyncExportPeriod(command.periodDays)) {
      return this.executeSync(command)
    }
    return this.executeAsync(command)
  }

  private async executeSync(command: RequestReportExportCommand): Promise<RequestReportExportResult> {
    if (command.rows === undefined || command.columns === undefined) {
      throw new ValidationError('rows/columns обязательны для синхронного экспорта (periodDays <= 31)', {
        periodDays: command.periodDays,
      })
    }
    const buffer = await this.renderer.renderSync(command.rows, command.columns, command.format)
    return { kind: 'sync', buffer }
  }

  private async executeAsync(command: RequestReportExportCommand): Promise<RequestReportExportResult> {
    const exportJobId = this.idGenerator.next()
    await this.jobsRepository.create({
      id: exportJobId,
      reportType: command.reportType,
      params: command.params,
      format: command.format,
      requestedBy: command.actorUserId,
      createdAt: this.clock.now(),
    })
    await this.queue.enqueue({
      exportJobId,
      reportType: command.reportType,
      params: command.params,
      format: command.format,
    })
    return { kind: 'async', exportJobId }
  }
}
