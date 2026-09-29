// Вызывающий — ИСКЛЮЧИТЕЛЬНО InventorySyncBatchProcessor (apps/worker, DTJ-441), мост как у revoke-expired-rotated-key.controller.ts.
import { Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import {
  ProcessInventorySyncBatchService,
  type ProcessInventorySyncBatchResult,
} from '@/modules/inventory/application/services/process-inventory-sync-batch.service.js'
import { InternalServiceGuard } from './internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'internal/inventory/sync-batches', version: '1' })
@UseGuards(InternalServiceGuard)
export class ProcessInventorySyncBatchController {
  public constructor(
    @Inject(ProcessInventorySyncBatchService) private readonly processBatch: ProcessInventorySyncBatchService,
  ) {}

  @Post(':id/process')
  @HttpCode(HttpStatus.OK)
  public async process(@Param('id', ID_PARSE_UUID) batchId: string): Promise<SuccessEnvelope<ProcessInventorySyncBatchResult>> {
    const result = await this.processBatch.process(batchId)
    return ok(result)
  }
}
