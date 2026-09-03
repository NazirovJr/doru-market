/**
 * `CodPolicyService` (EP-09, DTJ-229, SRS-DOM-007/156, SRS-ORD-024/025) —
 * `application/policies/` (`02` §3.4: авторизация/бизнес-правила в application, не в guard).
 *
 * Домен (`Order.create()`, `order-create.validators.ts::validateCodEligibility`, DTJ-221) уже
 * содержит ЖЁСТКУЮ проверку Rx/лимита как последний рубеж (SRS-DOM-007/156) — ЭТОТ сервис даёт
 * РАННЮЮ проверку ДО вызова домена/резерва остатка, чтобы `CheckoutUseCase` мог вернуть точный
 * `422` ВСЕГО checkout-запроса, а не похоронить отказ в `failedGroups` одной группы (домен
 * проверяет ПОСЛЕ `reserveStock`, внутри транзакции ОДНОЙ группы — там отказ становится
 * частичным `failedGroups`, не 4xx всего запроса, см. `CheckoutUseCase.processGroup`).
 *
 * Использует ТЕ ЖЕ классы ошибок, что домен (`CodForbiddenForRxError`/`CodLimitExceededError`,
 * `@dorutj/contracts`) — не заводит синонимы (правило 15 AGENTS.md): один код ошибки, два
 * места, где он МОЖЕТ быть брошен (раннее и как fallback), клиент видит одинаковый `422`
 * независимо от того, какой рубеж сработал.
 */
import { Inject, Injectable } from '@nestjs/common'
import { CodForbiddenForRxError, CodLimitExceededError } from '@dorutj/contracts'
import {
  TENANCY_FACADE_PORT,
  type TenancyFacadePort,
} from '@/modules/orders/application/ports/tenancy-facade.port.js'

export interface CodPolicyItemInput {
  readonly medicineId: string
  readonly isPrescriptionRequired: boolean
}

@Injectable()
export class CodPolicyService {
  constructor(@Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort) {}

  /**
   * Бросает `CodForbiddenForRxError`/`CodLimitExceededError`, если наличная оплата
   * недопустима для переданного набора позиций/суммы; иначе возвращается штатно (void).
   * Вызывающий (`CheckoutUseCase`) обязан вызывать это ТОЛЬКО для `paymentMethod ===
   * 'cash_courier'` — сервис сам не проверяет способ оплаты (неприменимо к другим методам).
   */
  async isCodAllowed(items: readonly CodPolicyItemInput[], totalAmountDiram: bigint, tenantId: string): Promise<void> {
    const rxItem = items.find((item) => item.isPrescriptionRequired)
    if (rxItem !== undefined) {
      throw new CodForbiddenForRxError({ tenantId, medicineId: rxItem.medicineId })
    }
    const codLimitDiram = await this.tenancyFacade.getCodLimitDiram(tenantId)
    if (totalAmountDiram > codLimitDiram) {
      throw new CodLimitExceededError({
        tenantId,
        totalDiram: totalAmountDiram.toString(),
        codLimitDiram: codLimitDiram.toString(),
      })
    }
  }
}
