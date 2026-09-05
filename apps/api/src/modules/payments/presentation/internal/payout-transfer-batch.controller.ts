/**
 * `PayoutTransferBatchController` (EP-10, DTJ-250, SRS-PAY-033/034) —
 * `POST /api/v1/internal/payouts/transfer-batch`, единственный HTTP-вход
 * `TransferPayoutBatchUseCase` (см. её JSDoc «МОСТ МЕЖДУ ПРОЦЕССАМИ» для полного обоснования).
 * Вызывающий — ИСКЛЮЧИТЕЛЬНО `apps/worker`: `PayoutExecutionJob` (DTJ-250).
 *
 * `PaymentsInternalServiceGuard` — переиспользован НАПРЯМУЮ (не дублирован, в отличие от
 * `system-cancel-order.controller.ts`/DTJ-253/254 в модуле `orders`): этот контроллер УЖЕ живёт
 * в модуле `payments`, том же, где определён гвард (`payments-internal-service.guard.ts`,
 * DTJ-244) — межмодульного `presentation`-импорта здесь нет, дублирование было бы неоправданным.
 *
 * `amountDiram` — `z.coerce.bigint()` (тот же приём, что `admin-payment-override.controller.ts`,
 * DTJ-246): bigint не сериализуется нативно в JSON, приходит строкой по проводу.
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  TransferPayoutBatchUseCase,
  type TransferPayoutBatchOutcome,
} from '@/modules/payments/application/use-cases/transfer-payout-batch.use-case.js'
import { PaymentsInternalServiceGuard } from './payments-internal-service.guard.js'

const PayoutTransferItemSchema = z.object({
  payoutScheduleId: z.uuid(),
  pharmacyMerchantRef: z.string().min(1),
  amountDiram: z.coerce.bigint().positive(),
})

const PayoutTransferBatchRequestSchema = z.object({
  payouts: z.array(PayoutTransferItemSchema),
})
type PayoutTransferBatchRequest = z.infer<typeof PayoutTransferBatchRequestSchema>

@Controller({ path: 'internal/payouts', version: '1' })
@UseGuards(PaymentsInternalServiceGuard)
export class PayoutTransferBatchController {
  public constructor(
    @Inject(TransferPayoutBatchUseCase) private readonly transferPayoutBatch: TransferPayoutBatchUseCase,
  ) {}

  @Post('transfer-batch')
  @HttpCode(HttpStatus.OK)
  public async transferBatch(
    @Body(new ZodValidationPipe(PayoutTransferBatchRequestSchema)) body: PayoutTransferBatchRequest,
  ): Promise<SuccessEnvelope<TransferPayoutBatchOutcome>> {
    const result = await this.transferPayoutBatch.execute({ payouts: body.payouts })
    return ok(result)
  }
}
