/**
 * `InventorySyncBatchStatusController` (EP-05, DTJ-158, SRS-INV-008).
 *
 * `GET /api/v1/inventory-sync-batches/:batchId` — поллинг финального статуса батча для
 * 1С/ERP (приём асинхронен, `202` из `POST /inventory/batch-update` не несёт итога).
 * Аутентификация — ТОТ ЖЕ `PharmacyApiKeyGuard` (DTJ-156), что `POST` — эндпоинт читает
 * данные конкретной аптеки/сети (принципал `pharmacy_system`), не человеческую роль
 * (та читает ЧЕРЕЗ `/admin/inventory-sync-batches` — DTJ-163, обычная RBAC-модель,
 * ДРУГОЙ контроллер для ДРУГОГО принципала на одни и те же данные).
 *
 * Владение (`InventorySyncReportQueryService`, §1.1 — контроллер НЕ трогает
 * `InventorySyncBatchRepository`/домен напрямую, см. её JSDoc): `batch.pharmacyId ===
 * principal.pharmacyId` ИЛИ (`principal.chainId !== null` И `batch.pharmacy.chainId ===
 * principal.chainId`) — иначе `404 NOT_FOUND` (не `403`, SRS-API-046-style: не
 * подтверждать существование чужого батча).
 *
 * **TODO(EP-19, DTJ-020):** `@RateLimit({ max: 20, windowSec: 60, keyBy: 'pharmacyId' })`
 * с ОБЩИМ счётчиком с `POST /inventory/batch-update` (SRS-INV-008 — один и тот же
 * `RATE_LIMIT_1C_BATCH_PER_MIN`) — декоратор `@RateLimit` не существует в кодовой базе
 * (DTJ-020 не реализован, см. `rate-limit-checker.port.ts` JSDoc и точно такой же TODO в
 * `inventory-batch-update.controller.ts` DTJ-157). Ничего не реализовывать здесь
 * самостоятельно — известное ограничение, риск зафиксирован в тикете.
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Param, Req, UseGuards } from '@nestjs/common'
import { type InventorySyncBatchStatusResponse, ErrorCode, fail, ok } from '@dorutj/contracts'
import {
  InventorySyncReportQueryService,
  type InventorySyncBatchStatusResult,
} from '@/modules/inventory/application/services/inventory-sync-report-query.service.js'
import {
  PharmacyApiKeyGuard,
  type FastifyRequestWithPrincipal,
  type PharmacySystemPrincipal,
} from '../guards/pharmacy-api-key.guard.js'

@Controller({ path: 'inventory-sync-batches', version: '1' })
@UseGuards(PharmacyApiKeyGuard)
export class InventorySyncBatchStatusController {
  constructor(
    @Inject(InventorySyncReportQueryService)
    private readonly reportQuery: InventorySyncReportQueryService,
  ) {}

  @Get(':batchId')
  async getStatus(
    @Param('batchId') batchId: string,
    @Req() req: FastifyRequestWithPrincipal,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req)
    const result = await this.reportQuery.getBatchStatusForPharmacySystemPrincipal({
      batchId,
      principalPharmacyId: principal.pharmacyId,
      principalChainId: principal.chainId,
    })
    if (result === null) {
      throw this.notFound()
    }
    return ok(toStatusResponse(result))
  }

  private requirePrincipal(req: FastifyRequestWithPrincipal): PharmacySystemPrincipal {
    const principal: PharmacySystemPrincipal | undefined = req.principal
    if (principal === undefined) {
      throw new HttpException(
        fail(ErrorCode.UNAUTHENTICATED, 'pharmacy principal required'),
        HttpStatus.UNAUTHORIZED,
      )
    }
    return principal
  }

  /** Чужой батч И несуществующий батч — НЕОТЛИЧИМЫ по ответу (см. JSDoc класса). */
  private notFound(): HttpException {
    return new HttpException(
      fail(ErrorCode.NOT_FOUND, 'inventory sync batch not found'),
      HttpStatus.NOT_FOUND,
    )
  }
}

function toStatusResponse(result: InventorySyncBatchStatusResult): InventorySyncBatchStatusResponse {
  return {
    batchId: result.batchId,
    status: result.status,
    channel: result.channel,
    syncType: result.syncType,
    totalRows: result.totalRows,
    acceptedRows: result.acceptedRows,
    rejectedRows: result.rejectedRows,
    receivedAt: result.receivedAt.toISOString(),
    completedAt: result.completedAt === null ? null : result.completedAt.toISOString(),
  }
}
