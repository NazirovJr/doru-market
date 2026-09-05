/**
 * `SuspendChainForUnpaidInvoiceController` (EP-10, DTJ-252) — `POST /api/v1/internal/
 * pharmacy-chains/:id/suspend-for-unpaid-invoice`, HTTP-мост `apps/worker` (`BillingInvoiceOverdueJob`)
 * → этот эндпоинт → `OnboardingFacadePort.suspendChain` → `OnboardingFacade.
 * suspendChainForUnpaidInvoice`. ТОТ ЖЕ приём моста, что `OrderDeliveredController` (DTJ-244) —
 * `apps/worker` физически не может вызвать DI-порт `apps/api` напрямую (другой Node-процесс,
 * `apps/worker/package.json` не зависит от `@dorutj/api`, см. отчёт сдачи).
 *
 * `PaymentsInternalServiceGuard` — ПЕРЕИСПОЛЬЗУЕТСЯ напрямую (уже существует в этом же модуле,
 * DTJ-244), не дублируется: `x-internal-api-key` секрет ОБЩИЙ для всех internal-мостов
 * `payments` (тот же секрет, что `OrderDeliveredController`).
 *
 * Тело запроса ПУСТОЕ (в отличие от `OrderDeliveredController`, который несёт `tenantId` —
 * `pharmacy_chains` не скоупится тенантом, REQ-MON-6) — только `:id` в пути.
 */
import { Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '@/modules/payments/application/ports/onboarding-facade.port.js'
import { PaymentsInternalServiceGuard } from './payments-internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'internal/pharmacy-chains', version: '1' })
@UseGuards(PaymentsInternalServiceGuard)
export class SuspendChainForUnpaidInvoiceController {
  public constructor(@Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort) {}

  @Post(':id/suspend-for-unpaid-invoice')
  @HttpCode(HttpStatus.OK)
  public async suspend(@Param('id', ID_PARSE_UUID) chainId: string): Promise<SuccessEnvelope<{ readonly suspended: true }>> {
    await this.onboardingFacade.suspendChain(chainId)
    return ok({ suspended: true })
  }
}
