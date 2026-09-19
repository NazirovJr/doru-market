/**
 * `GetHandoverOtpUseCase` (DTJ-306, EP-12, модуль 24 §A.5, SRS-PHT-028) — просмотр OTP вручения,
 * `GET /api/v1/orders/:id/handover-otp`. Фармацевт/`pharmacy_admin` своей аптеки может посмотреть
 * действующий код вручения (чтобы продиктовать клиенту), только пока заказ `picked_up` — иначе
 * `404 HandoverOtpNotFoundError` (не светить использованный/недействующий код, SRS-PHT-028).
 *
 * Чистое чтение — без транзакции/`unitOfWork` (в отличие от `RegenerateHandoverOtpUseCase`,
 * который мутирует состояние). `OtpCodesRepository.findById` (ДОБАВЛЕНО этим тикетом, см. её
 * JSDoc) — простое нетранзакционное чтение, `findByIdForUpdate` здесь избыточен.
 *
 * `otpCodeRecord.plainCode` (ДОБАВЛЕНО этим тикетом, миграция
 * `0048_otp_codes_plain_code_for_handover.sql`) — `code_hash` необратим, повторный показ кода
 * возможен ТОЛЬКО если `CompletePickingUseCase`/`RegenerateHandoverOtpUseCase` сохранили его явно
 * (см. их JSDoc). `plainCode === null` (строка создана до DTJ-306) — тот же класс отказа, что
 * «код вообще не найден» (404, не 500).
 *
 * **Аудит (SRS-PHT-029/EP-16):** каждый успешный вызов пишет запись в `AuditLogPort`
 * (`action='handover_otp_viewed'`). Отклонённые попытки (404/403) НЕ логируются — тикет
 * называет отдельно только «просмотры».
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, HandoverOtpNotFoundError, NotFoundError } from '@dorutj/contracts'
import { OTP_CODES_REPOSITORY, type OtpCodesRepository } from '@/modules/auth/index.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { OrderPolicy } from '@/modules/orders/application/policies/order.policy.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'

export interface GetHandoverOtpActor {
  readonly userId: string
  readonly role: 'pharmacist' | 'pharmacy_admin'
  readonly tenantId: string
  readonly pharmacyId: string | null
}

export interface GetHandoverOtpCommand {
  readonly orderId: string
  readonly actor: GetHandoverOtpActor
}

export interface GetHandoverOtpResult {
  readonly code: string
  readonly expiresAt: Date
  readonly purpose: 'delivery_handover'
}

@Injectable()
export class GetHandoverOtpUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(OTP_CODES_REPOSITORY) private readonly otpCodesRepository: OtpCodesRepository,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  async execute(cmd: GetHandoverOtpCommand): Promise<GetHandoverOtpResult> {
    const order = await this.loadAuthorizedOrder(cmd)
    const handoverOtpId = order.toSnapshot().handoverOtpId
    if (order.status !== 'picked_up' || handoverOtpId === null) {
      throw new HandoverOtpNotFoundError({ orderId: cmd.orderId })
    }

    const otpCodeRecord = await this.otpCodesRepository.findById(handoverOtpId)
    if (otpCodeRecord?.plainCode == null) {
      throw new HandoverOtpNotFoundError({ orderId: cmd.orderId })
    }

    await this.auditLog.write({
      category: 'pharmacy_terminal',
      entityType: 'order',
      entityId: cmd.orderId,
      actorUserId: cmd.actor.userId,
      action: 'handover_otp_viewed',
      metadata: {},
      requestId: null,
      tenantId: cmd.actor.tenantId,
    })

    return { code: otpCodeRecord.plainCode, expiresAt: otpCodeRecord.expiresAt, purpose: 'delivery_handover' }
  }

  /** Загрузка + тенант-скоуп + `OrderPolicy` — единая точка проверки доступа (см. `ScanOrderItemUseCase`/`ReportItemIssueUseCase`). */
  private async loadAuthorizedOrder(cmd: GetHandoverOtpCommand): Promise<Order> {
    const order = await this.orderRepository.findById(cmd.actor.tenantId, cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    if (!OrderPolicy.canViewHandoverOtp(order, cmd.actor)) {
      throw new ForbiddenError('This order cannot be managed by this actor', { orderId: cmd.orderId })
    }
    return order
  }
}
