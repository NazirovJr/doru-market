/**
 * `RegenerateHandoverOtpUseCase` (DTJ-306, EP-12, модуль 24 §A.5, SRS-PHT-029) — регенерация
 * OTP вручения, `POST /api/v1/orders/:id/handover-otp/regenerate`. Создаёт НОВУЮ строку
 * `otp_codes` (append-only, старая НЕ переиспользуется/не консьюмится) и атомарно переключает
 * `orders.handover_otp_id` на неё (`Order.switchHandoverOtp()`) — прежний код теряет силу
 * автоматически (курьер сверяется ТОЛЬКО с текущим FK).
 *
 * **Rate-limit (SRS-PHT-029, `tenant_settings`):**
 *   - `handover_otp_max_regenerations_per_order` (дефолт 20) — считается через
 *     `OtpCodesRepository.countBySubjectAndPurpose` (ДОБАВЛЕНО этим тикетом): append-only
 *     таблица уже несёт эту информацию, отдельный денормализованный счётчик на `Order` не
 *     заводится (`02` C15). `existingCount` строк ДО этого вызова = число уже случившихся
 *     регенераций + 1 (исходная строка от `CompletePickingUseCase`) — отклоняем, если
 *     `existingCount > maxRegenerations`; после успешного создания новой строки
 *     `regenerationsUsed = existingCount` (эта регенерация — по счёту `existingCount`-я).
 *   - `handover_otp_regenerate_min_interval_seconds` (дефолт 60) — читается из `issuedAt`
 *     ТЕКУЩЕЙ строки `otp_codes` (`OtpCodesRepository.findById`).
 * Оба лимита исчерпаны/не выдержаны → `429 RATE_LIMITED`
 * (`HandoverOtpRegenerationRateLimitedError`, `packages/contracts`).
 *
 * `codeHash` пересчитывается С СОЛЬЮ (`id` новой строки) — 1:1 приём `CompletePickingUseCase.
 * issueHandoverOtp`/`hashOtpCode` (`CryptoOtpGeneratorAdapter.generate()` возвращает НЕсолёный
 * хеш). `plainCode` (ДОБАВЛЕНО этим тикетом, миграция `0048_otp_codes_plain_code_for_handover.sql`)
 * сохраняется РЯДОМ с хешем — см. её JSDoc, почему это осознанно безопасно ТОЛЬКО для
 * `purpose='delivery_handover'`.
 *
 * `HandoverOtpRegeneratedEvent` строится и публикуется ЗДЕСЬ, не внутри `Order.
 * switchHandoverOtp()` (см. её JSDoc) — тот же приём, что `ProposePartialFulfillmentUseCase`.
 * `deliveryAssignmentId: null` — `TODO(EP-13)`: модуль `delivery` на сегодня несёт только
 * `domain/`-слой, синхронизировать `delivery_assignments.handover_otp_id` нечем.
 *
 * **Аудит (SRS-PHT-029/EP-16):** запись в `AuditLogPort` — ТОЛЬКО на успешный вызов
 * (`action='handover_otp_regenerated'`), тот же приём, что `CompletePickingUseCase`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { ForbiddenError, HandoverOtpNotFoundError, HandoverOtpRegenerationRateLimitedError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { OTP_CODES_REPOSITORY, OTP_GENERATOR, type OtpCodesRepository, type OtpGeneratorPort } from '@/modules/auth/index.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'
import {
  ORDERS_UNIT_OF_WORK,
  type OrderUnitOfWorkTx,
  type OrdersUnitOfWorkPort,
} from '@/modules/orders/application/ports/unit-of-work.port.js'
import { TENANCY_FACADE_PORT, type TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { OrderPolicy } from '@/modules/orders/application/policies/order.policy.js'
import {
  ORDERS_OUTBOX,
  type OrdersOutboxPort,
} from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'

const HANDOVER_OTP_PURPOSE = 'delivery_handover'
/** 1:1 с `CompletePickingUseCase` (SRS-DOM-080) — тот же TTL для КАЖДОЙ строки `otp_codes`
 *  этого purpose, регенерация не меняет длительность жизни кода. */
const HANDOVER_OTP_TTL_SECONDS = 900
const MILLISECONDS_PER_SECOND = 1000
const SHA256_HEX_LENGTH = 64

export interface RegenerateHandoverOtpActor {
  readonly userId: string
  readonly role: 'pharmacist' | 'pharmacy_admin'
  readonly tenantId: string
  readonly pharmacyId: string | null
}

export interface RegenerateHandoverOtpCommand {
  readonly orderId: string
  readonly actor: RegenerateHandoverOtpActor
}

export interface RegenerateHandoverOtpResult {
  readonly code: string
  readonly expiresAt: Date
  readonly purpose: 'delivery_handover'
  readonly regenerationsUsed: number
}

@Injectable()
export class RegenerateHandoverOtpUseCase {
  // eslint-disable-next-line max-params -- 8 портов, тот же класс use case'а, что PartiallyRefundOrderUseCase/PartialFulfillment*.
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(OTP_GENERATOR) private readonly otpGenerator: OtpGeneratorPort,
    @Inject(OTP_CODES_REPOSITORY) private readonly otpCodesRepository: OtpCodesRepository,
    @Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
  ) {}

  async execute(cmd: RegenerateHandoverOtpCommand): Promise<RegenerateHandoverOtpResult> {
    const order = await this.loadAuthorizedOrder(cmd)
    const currentOtpId = order.toSnapshot().handoverOtpId
    if (order.status !== 'picked_up' || currentOtpId === null) {
      throw new HandoverOtpNotFoundError({ orderId: cmd.orderId })
    }

    const existingCount = await this.assertRateLimit(cmd, currentOtpId)

    const now = this.clock.now()
    const newHandoverOtp = await this.issueNewHandoverOtp(order.id, cmd.actor.tenantId, now)
    const result = await this.unitOfWork.run((tx) =>
      this.persist({ order, newHandoverOtp, regenerationsUsed: existingCount, tenantId: cmd.actor.tenantId, now, tx }),
    )

    await this.auditLog.write({
      category: 'pharmacy_terminal',
      entityType: 'order',
      entityId: cmd.orderId,
      actorUserId: cmd.actor.userId,
      action: 'handover_otp_regenerated',
      metadata: { extra: { regenerationsUsed: result.regenerationsUsed } },
      requestId: null,
      tenantId: cmd.actor.tenantId,
    })

    return result
  }

  /** `order.switchHandoverOtp()` + событие + `save`/`outbox` — ОДНА транзакция, 1:1 приём
   *  `CompletePickingUseCase.persist` (событие строится ЗДЕСЬ, не в `Order`, см. JSDoc файла). */
  private async persist(input: {
    readonly order: Order
    readonly newHandoverOtp: { readonly id: string; readonly code: string; readonly expiresAt: Date }
    readonly regenerationsUsed: number
    readonly tenantId: string
    readonly now: Date
    readonly tx: OrderUnitOfWorkTx
  }): Promise<RegenerateHandoverOtpResult> {
    const { order, newHandoverOtp, regenerationsUsed, tenantId, now, tx } = input
    order.switchHandoverOtp(newHandoverOtp.id, now)
    await this.orderRepository.save(order, tx)
    const event = {
      type: 'HandoverOtpRegeneratedEvent' as const,
      orderId: order.id,
      deliveryAssignmentId: null,
      regeneratedAt: now,
      regenerationsUsed,
    }
    await this.ordersOutbox.appendAll(tenantId, [...order.pullDomainEvents(), event], tx)
    return { code: newHandoverOtp.code, expiresAt: newHandoverOtp.expiresAt, purpose: HANDOVER_OTP_PURPOSE, regenerationsUsed }
  }

  /** Загрузка + тенант-скоуп + `OrderPolicy` — единая точка проверки доступа (см. `ScanOrderItemUseCase`/`ReportItemIssueUseCase`). */
  private async loadAuthorizedOrder(cmd: RegenerateHandoverOtpCommand): Promise<Order> {
    const order = await this.orderRepository.findById(cmd.actor.tenantId, cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    if (!OrderPolicy.canViewHandoverOtp(order, cmd.actor)) {
      throw new ForbiddenError('This order cannot be managed by this actor', { orderId: cmd.orderId })
    }
    return order
  }

  /** Given лимит регенераций исчерпан ИЛИ интервал не выдержан, Then `429 RATE_LIMITED` (тикет п.3).
   *  Возвращает `existingCount` (строк `otp_codes` ДО этого вызова) — переиспользуется как
   *  `regenerationsUsed` этой попытки, см. JSDoc файла. */
  private async assertRateLimit(cmd: RegenerateHandoverOtpCommand, currentOtpId: string): Promise<number> {
    const existingCount = await this.otpCodesRepository.countBySubjectAndPurpose(
      cmd.actor.tenantId,
      cmd.orderId,
      HANDOVER_OTP_PURPOSE,
    )
    const maxRegenerations = await this.tenancyFacade.getHandoverOtpMaxRegenerationsPerOrder(cmd.actor.tenantId)
    if (existingCount > maxRegenerations) {
      throw new HandoverOtpRegenerationRateLimitedError({ orderId: cmd.orderId, existingCount, maxRegenerations })
    }

    const currentOtp = await this.otpCodesRepository.findById(currentOtpId)
    if (currentOtp === null) {
      return existingCount
    }
    const minIntervalSeconds = await this.tenancyFacade.getHandoverOtpRegenerateMinIntervalSeconds(cmd.actor.tenantId)
    const secondsSinceIssued = (this.clock.now().getTime() - currentOtp.issuedAt.getTime()) / MILLISECONDS_PER_SECOND
    if (secondsSinceIssued < minIntervalSeconds) {
      throw new HandoverOtpRegenerationRateLimitedError({ orderId: cmd.orderId, secondsSinceIssued, minIntervalSeconds })
    }
    return existingCount
  }

  /** Выпускает новую строку `otp_codes` (append-only) — 1:1 приём `CompletePickingUseCase.issueHandoverOtp`. */
  private async issueNewHandoverOtp(
    orderId: string,
    tenantId: string,
    now: Date,
  ): Promise<{ readonly id: string; readonly code: string; readonly expiresAt: Date }> {
    const id = this.idGenerator.next()
    const { code } = this.otpGenerator.generate(HANDOVER_OTP_PURPOSE)
    const codeHash = hashOtpCode(code, id)
    const expiresAt = addSeconds(now, HANDOVER_OTP_TTL_SECONDS)
    await this.otpCodesRepository.create({
      id,
      tenantId,
      subjectRef: orderId,
      purpose: HANDOVER_OTP_PURPOSE,
      codeHash,
      plainCode: code,
      issuedAt: now,
      expiresAt,
    })
    return { id, code, expiresAt }
  }
}

/** 1:1 с `CompletePickingUseCase.addSeconds`. */
function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * MILLISECONDS_PER_SECOND)
}

/** 1:1 с `CompletePickingUseCase.hashOtpCode`/`RequestOtpUseCase.hashCodeWithSalt` (SRS-API-021). */
function hashOtpCode(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
}
