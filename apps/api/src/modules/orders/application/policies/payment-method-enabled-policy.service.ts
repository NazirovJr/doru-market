/**
 * `PaymentMethodEnabledPolicyService` (EP-09, DTJ-229 «Что сделать» п.3, SRS-ORD-025 п.2) —
 * `application/policies/` (`02` §3.4). НЕ в `files_owned` тикета буквально (только
 * `cod-policy.service.ts` перечислен рядом), но ткикет явно описывает эту policy в «Что
 * сделать» п.3 c именем/сигнатурой — заведена по факту описания, не по списку файлов (тот же
 * класс расхождения, что `foundIssues` других тикетов этого эпика, где `files_owned` неполон
 * относительно текста задачи).
 *
 * Читает `tenantSettings.enabledPaymentMethods` через `TenancyFacadePort.
 * getEnabledPaymentMethods` (РАСШИРЕНИЕ порта этим тикетом, `tenancy-facade.port.ts`).
 * `enabled_payment_methods` физически отсутствует в схеме `tenant_settings` (Group C, вне
 * владения) — адаптер (`TenancyFacadeAdapter`) уже деградирует до жёстко закодированного R1-
 * дефолта `['cash_courier']` (см. его JSDoc) — ЭТА policy не знает и не обязана знать о
 * деградации, только использует результат порта как есть (единая точка деградации, не две).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { OrderPaymentMethod } from '@dorutj/contracts'
import {
  TENANCY_FACADE_PORT,
  type TenancyFacadePort,
} from '@/modules/orders/application/ports/tenancy-facade.port.js'

@Injectable()
export class PaymentMethodEnabledPolicyService {
  constructor(@Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort) {}

  async isEnabled(paymentMethod: OrderPaymentMethod, tenantId: string): Promise<boolean> {
    const enabled = await this.tenancyFacade.getEnabledPaymentMethods(tenantId)
    return enabled.includes(paymentMethod)
  }
}
