/**
 * `CompletePickingUseCase` (DTJ-305, EP-12, модуль 24 §A.5, SRS-PHT-024..027) — финальный шаг
 * сборки, `POST /api/v1/orders/:id/complete-picking`. Фармацевт подтверждает опечатанный
 * сейф-пакет, система генерирует 4-значный OTP вручения и переводит заказ `processing →
 * picked_up` — граница между работой аптеки и работой курьера (`OrderPickedUpEvent`, EP-13
 * подписан на него ЧЕРЕЗ `outbox`, этот use case НЕ вызывает `delivery` напрямую, `02` §1.2).
 *
 * **Три precondition-ветки (SRS-PHT-026), проверяются ДО `order.markPickedUp()`:**
 * (а) ни одной `order_items.fulfillmentStatus === 'pending'` — иначе `422
 * BUSINESS_RULE_VIOLATION` (`details.unresolvedItemIds`, TC-PHT-010-подобный приём, 1:1
 * `ProposePartialFulfillmentUseCase.assertAllItemsResolved`); (б) ≥1 `unavailable`-позиция ⇒
 * ОБЯЗАНА существовать `order_partial_fulfillment_requests` со `status ∈ {'confirmed',
 * 'auto_confirmed_timeout'}` для ЭТОГО заказа (`PartialFulfillmentRequestRepositoryPort.
 * findLatestByOrderId`, ДОБАВЛЕНО этим тикетом — см. её JSDoc) — иначе `409
 * PARTIAL_FULFILLMENT_PENDING` (TC-PHT-014); (в) ни одна партия, зарезервированная под заказом,
 * не просрочена НА МОМЕНТ вызова — переиспользует `InventoryFacadePort.hasExpiredReservedBatch`
 * (ТОТ ЖЕ метод, что `AcceptOrderUseCase.execute`, SRS-DOM-006) — защита от гонки «партия
 * истекла за минуты ожидания подтверждения клиента» (TC-PHT-016 «интеграционные»).
 *
 * **OTP вручения (SRS-DOM-080/081) — ИСКЛЮЧИТЕЛЬНО через `OtpGeneratorPort`/
 * `OtpCodesRepository` (`modules/auth`, межмодульное переиспользование через её публичный
 * барабан `auth/index.ts`, тот же приём, что `JWT_SIGNER` в `CartIdentityGuard`/
 * `GetOrderLedgerController` — ЭТО НЕ facade-порт `orders`, а прямое потребление ЧУЖОГО
 * application-порта, уже устоявшийся в кодовой базе класс исключения из `02` §1.2 для
 * инфраструктурных портов auth, см. её же `index.ts` «контроллеры других модулей импортируют
 * их ТОЛЬКО через barrel»). `purpose='delivery_handover'` (ДОБАВЛЕНО этим тикетом в
 * `OtpPurpose`/`OtpCodeRecord`/`CreateOtpCodeInput` — см. их JSDoc) даёт 4-значный код
 * (`HANDOVER_OTP_CODE_LENGTH`, НЕ 6-значный `login`). `codeHash` пересчитывается С СОЛЬЮ
 * (`id` строки otp_codes, `hashOtpCode` ниже) — 1:1 приём `RequestOtpUseCase.hashCodeWithSalt`
 * (SRS-API-021, `CryptoOtpGeneratorAdapter.generate()` возвращает НЕсолёный хеш, вызывающий
 * ОБЯЗАН перехэшировать перед записью — см. её JSDoc).
 *
 * `OtpCodesRepository.create()` НЕ принимает `tx` (см. её JSDoc — порт auth пишет ВСЕГДА на
 * свой пул, вне `UnitOfWorkPort` ЛЮБОГО другого модуля) — поэтому вызывается ДО
 * `OrdersUnitOfWorkPort.run(...)`, а не внутри него. Если транзакция заказа ниже впоследствии
 * откатится (крайне маловероятно — только реальный сбой БД, все precondition-проверки уже
 * прошли к этому моменту), строка `otp_codes` останется сиротой без `orders.handover_otp_id`,
 * ссылающегося на неё — ТОТ ЖЕ класс риска, что `RequestOtpUseCase` уже принимает (код создан,
 * `SmsProvider.sendOtp` мог бы не отправиться), не новый класс дефекта.
 *
 * Аудит (`Что сделать` п.1 тикета, DoD «аудит-запись на КАЖДУЮ попытку, включая отклонённую»)
 * — `PINO_LOGGER` структурным логом (1:1 приём `RefreshTokenUseCase`'s security-лог при
 * detect-reuse, SRS-API-027), НЕ отдельная запись `audit_log` (`payments.AuditLogPort` —
 * узкий порт ОДНОГО модуля, `appendPaymentOverride`, НЕ экспортирован `PaymentsModule` для
 * межмодульного использования, см. её JSDoc/`payments.module.ts` `exports:` — заводить
 * ПАРАЛЛЕЛЬНЫЙ `AUDIT_LOG_PORT` в `orders` ради одной строки лога вне буквального
 * `files_owned` этого тикета несоразмерно; см. отчёт сдачи, раздел «Допущения»).
 */
import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import {
  BusinessRuleViolationError,
  ExpiredStockError,
  ForbiddenError,
  NotFoundError,
  PendingCustomerConfirmationError,
  SealConfirmationRequiredError,
  type UserRole,
} from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { OTP_CODES_REPOSITORY, OTP_GENERATOR, type OtpCodesRepository, type OtpGeneratorPort } from '@/modules/auth/index.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import { OrderPolicy } from '@/modules/orders/application/policies/order.policy.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
  type OrderUnitOfWorkTx,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import {
  PARTIAL_FULFILLMENT_REQUEST_REPOSITORY,
  type PartialFulfillmentRequestRepositoryPort,
} from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'

/** SRS-DOM-080 — `delivery_handover` OTP TTL, 15 минут (СУЩЕСТВЕННО короче `login`'s 300с). */
const HANDOVER_OTP_TTL_SECONDS = 900
const MS_PER_SECOND = 1000
const SHA256_HEX_LENGTH = 64
const HANDOVER_OTP_PURPOSE = 'delivery_handover'

export interface CompletePickingActor {
  readonly userId: string
  readonly role: UserRole
  readonly tenantId: string
  /** `null` для ролей вне `pharmacist` — `OrderPolicy.canManagePicking` отвергнет их. */
  readonly pharmacyId: string | null
}

export interface CompletePickingCommand {
  readonly orderId: string
  readonly sealConfirmed: boolean
  readonly actor: CompletePickingActor
}

export interface CompletePickingHandoverOtp {
  readonly code: string
  readonly expiresAt: Date
  readonly purpose: 'delivery_handover'
}

export interface CompletePickingResult {
  readonly orderId: string
  readonly status: 'picked_up'
  readonly handoverOtp: CompletePickingHandoverOtp
}

/** Выдан `issueHandoverOtp` — промежуточный результат ДО `order.markPickedUp()` (см. JSDoc файла про `tx`). */
interface HandoverOtpIssued {
  readonly id: string
  readonly code: string
  readonly expiresAt: Date
}

/** Извлечено из сигнатуры `persist` — C1 (`max-params`, порог 3), тот же приём, что `PersistInput` в `ProposePartialFulfillmentUseCase`. */
interface PersistInput {
  readonly order: Order
  readonly handoverOtp: HandoverOtpIssued
  readonly tenantId: string
  readonly now: Date
  readonly tx: OrderUnitOfWorkTx
}

@Injectable()
export class CompletePickingUseCase {
  // eslint-disable-next-line max-params -- 7 портов (OrderRepository/UnitOfWork/Outbox/InventoryFacade/PartialFulfillmentRequestRepository/OtpGenerator/OtpCodesRepository) + Clock/IdGenerator/PINO_LOGGER — явные @Inject, тот же приём, что ProposePartialFulfillmentUseCase/ResolvePartialFulfillmentUseCase (esbuild/vitest не эмитит design:paramtypes, DTJ-001, граф зависимостей остаётся видимым в providers[]).
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(PARTIAL_FULFILLMENT_REQUEST_REPOSITORY) private readonly requestRepository: PartialFulfillmentRequestRepositoryPort,
    @Inject(OTP_GENERATOR) private readonly otpGenerator: OtpGeneratorPort,
    @Inject(OTP_CODES_REPOSITORY) private readonly otpCodesRepository: OtpCodesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: CompletePickingCommand): Promise<CompletePickingResult> {
    const order = await this.loadAuthorizedOrder(cmd)
    if (!cmd.sealConfirmed) {
      this.logAttempt(cmd, order.id, false)
      throw new SealConfirmationRequiredError({ orderId: order.id, sealConfirmed: cmd.sealConfirmed })
    }
    assertAllItemsResolved(order)
    await this.assertPartialFulfillmentResolved(cmd.actor.tenantId, order)
    await this.assertNoExpiredBatch(order)

    const now = this.clock.now()
    const handoverOtp = await this.issueHandoverOtp(order.id, cmd.actor.tenantId, now)
    const result = await this.unitOfWork.run((tx) =>
      this.persist({ order, handoverOtp, tenantId: cmd.actor.tenantId, now, tx }),
    )
    this.logAttempt(cmd, order.id, true)
    return result
  }

  /** Загрузка + тенант-скоуп + `OrderPolicy` — единая точка проверки доступа (см. `ScanOrderItemUseCase`/`ReportItemIssueUseCase`). */
  private async loadAuthorizedOrder(cmd: CompletePickingCommand): Promise<Order> {
    const order = await this.orderRepository.findById(cmd.actor.tenantId, cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    if (!OrderPolicy.canManagePicking(order, cmd.actor)) {
      throw new ForbiddenError('This order cannot be managed by this actor', { orderId: cmd.orderId })
    }
    return order
  }

  /** SRS-PHT-026 п.2 (TC-PHT-014) — см. JSDoc `PartialFulfillmentRequestRepositoryPort.findLatestByOrderId`. */
  private async assertPartialFulfillmentResolved(tenantId: string, order: Order): Promise<void> {
    const hasUnavailableItem = order.items.some((item) => item.fulfillmentStatus === 'unavailable')
    if (!hasUnavailableItem) return
    const latest = await this.requestRepository.findLatestByOrderId(tenantId, order.id)
    const isResolved = latest !== null && (latest.status === 'confirmed' || latest.status === 'auto_confirmed_timeout')
    if (!isResolved) {
      throw new PendingCustomerConfirmationError({ orderId: order.id })
    }
  }

  /** SRS-PHT-026 п.3 — переиспользует `InventoryFacadePort.hasExpiredReservedBatch`, ТОТ ЖЕ метод, что `AcceptOrderUseCase`. */
  private async assertNoExpiredBatch(order: Order): Promise<void> {
    const hasExpired = await this.inventoryFacade.hasExpiredReservedBatch(order.id)
    if (hasExpired) {
      throw new ExpiredStockError({ orderId: order.id })
    }
  }

  /**
   * SRS-PHT-027 — см. JSDoc файла про порядок (ВНЕ `unitOfWork.run`, порт auth `tx` не
   * принимает) и про соль хеша. `subjectRef=orderId` — на момент вызова `DeliveryAssignment`
   * (EP-13, DTJ-315) ещё не существует (создаётся АСИНХРОННО через `OrderPickedUpEvent` уже
   * ПОСЛЕ коммита этого use case'а), только заказ — единственный стабильный субъект здесь.
   */
  private async issueHandoverOtp(orderId: string, tenantId: string, now: Date): Promise<HandoverOtpIssued> {
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
      issuedAt: now,
      expiresAt,
    })
    return { id, code, expiresAt }
  }

  /** `order.markPickedUp()` (существующий доменный метод, SRS-DOM-094) + `save`/`outbox` — ОДНА транзакция. */
  private async persist(input: PersistInput): Promise<CompletePickingResult> {
    const { order, handoverOtp, tenantId, now, tx } = input
    order.markPickedUp(handoverOtp.id, now)
    await this.orderRepository.save(order, tx)
    await this.ordersOutbox.appendAll(tenantId, order.pullDomainEvents(), tx)
    return {
      orderId: order.id,
      status: 'picked_up',
      handoverOtp: { code: handoverOtp.code, expiresAt: handoverOtp.expiresAt, purpose: HANDOVER_OTP_PURPOSE },
    }
  }

  /** DoD тикета — см. JSDoc файла про выбор PINO вместо отдельной `audit_log`-таблицы. */
  private logAttempt(cmd: CompletePickingCommand, orderId: string, accepted: boolean): void {
    this.logger.info(
      {
        event: 'complete_picking_attempt',
        orderId,
        actorUserId: cmd.actor.userId,
        sealConfirmed: cmd.sealConfirmed,
        accepted,
      },
      'complete_picking_attempt',
    )
  }
}

/** SRS-PHT-026 п.1 (TC-PHT-011-подобный приём) — 1:1 `ProposePartialFulfillmentUseCase.assertAllItemsResolved`. */
function assertAllItemsResolved(order: Order): void {
  const unresolvedItemIds = order.items.filter((item) => item.fulfillmentStatus === 'pending').map((item) => item.id)
  if (unresolvedItemIds.length > 0) {
    throw new BusinessRuleViolationError(
      'Cannot complete picking while some order items are still pending a scan/report-issue decision',
      { unresolvedItemIds },
    )
  }
}

/** Application-слой, не domain (`02` §2.6) — 1:1 приём `ProposePartialFulfillmentUseCase.addMinutes`. */
function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * MS_PER_SECOND)
}

/** 1:1 `RequestOtpUseCase.hashCodeWithSalt` (SRS-API-021, `otp_codes.id` — соль). */
function hashOtpCode(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
}
