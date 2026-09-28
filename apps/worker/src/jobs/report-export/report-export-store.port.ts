/** Порт мутации `export_jobs` со стороны `apps/worker` (EP-15, DTJ-361) — прямой `pg.Pool`, тот же приём, что `PayoutExecutionStorePort` (`payout_schedule` без доменного агрегата, DTJ-249). */
export interface ReportExportStorePort {
  markReady(exportJobId: string, downloadUrl: string, completedAt: Date): Promise<void>
  markFailed(exportJobId: string, completedAt: Date): Promise<void>
}
