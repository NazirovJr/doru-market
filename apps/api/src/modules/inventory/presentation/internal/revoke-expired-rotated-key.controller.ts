// Вызывающий — ИСКЛЮЧИТЕЛЬНО RevokeExpiredRotatedKeysJob (apps/worker), мост как у system-cancel-order.controller.ts.
import { Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { InventoryFacade } from '@/modules/inventory/inventory.facade.js'
import { InternalServiceGuard } from './internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'internal/pharmacy-api-keys', version: '1' })
@UseGuards(InternalServiceGuard)
export class RevokeExpiredRotatedKeyController {
  public constructor(@Inject(InventoryFacade) private readonly inventoryFacade: InventoryFacade) {}

  @Post(':id/revoke-expired')
  @HttpCode(HttpStatus.OK)
  public async revokeExpired(@Param('id', ID_PARSE_UUID) keyId: string): Promise<SuccessEnvelope<{ readonly revoked: boolean }>> {
    const revoked = await this.inventoryFacade.revokeExpiredRotatedKey(keyId)
    return ok({ revoked })
  }
}
