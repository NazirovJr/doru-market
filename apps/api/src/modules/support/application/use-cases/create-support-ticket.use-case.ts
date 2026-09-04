/**
 * `CreateSupportTicketUseCase` (EP-14, DTJ-279, SRS-ADM-053/074).
 *
 * ЕДИНСТВЕННАЯ точка создания обращения в системе — единственное место, гарантирующее, что R1
 * физически не может открыть денежно-блокирующий спор, даже если клиент передаст
 * `isEscrowBlocking: true` в теле запроса. Гарантия — АРХИТЕКТУРНАЯ, не «проверка на всякий
 * случай»: `SupportTicket.open()` (DTJ-278) структурно не принимает такой параметр — см. её
 * JSDoc. Этот use case НЕ добавляет дополнительный `if`, обнуляющий флаг, — самого способа его
 * передать не существует.
 *
 * Ориентир для R3-расширения (флаг `disputes_workflow_enabled`, SRS-ADM-053/077): когда
 * `OpenDisputeUseCase` появится, он РАСШИРИТ сигнатуру `SupportTicket.open()` новым параметром
 * (и вызовет ЕЁ) — этот use case не получит собственный `if (isEscrowBlocking) {...}` в обход
 * домена, иначе гарантия перестаёт быть архитектурной.
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §3: use case не знает про HTTP, вход — простой командный
 * объект, выход — простой результат.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, type SupportTicketChannel, type UserRole } from '@dorutj/contracts'
import { isErr } from '@dorutj/domain-kernel'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { ID_GENERATOR, type IdGenerator } from '@/shared-kernel/application/ports/id-generator.port.js'
import { SupportTicket, SupportTicketCategory } from '../../domain/index.js'
import {
  SUPPORT_TICKETS_REPOSITORY,
  type SupportTicketsRepositoryPort,
} from '../ports/support-tickets-repository.port.js'
import { SUPPORT_ORDERS_FACADE_PORT, type SupportOrdersFacadePort } from '../ports/support-orders-facade.port.js'
import {
  SUPPORT_TENANT_SETTINGS_PORT,
  type SupportTenantSettingsPort,
} from '../ports/support-tenant-settings.port.js'
import { SUPPORT_UNIT_OF_WORK, type SupportUnitOfWorkPort } from '../ports/support-unit-of-work.port.js'
import { SUPPORT_OUTBOX, type SupportOutboxPort } from '../ports/support-outbox.port.js'

const CREATED_TICKET_PRIORITY = 0

export interface CreateSupportTicketCommand {
  readonly tenantId: string
  readonly orderId?: string
  readonly channel: SupportTicketChannel
  readonly category: string
  readonly createdBy?: string
  readonly description?: string
  readonly actorRole: UserRole
}

export interface CreateSupportTicketResult {
  readonly ticketId: string
}

@Injectable()
export class CreateSupportTicketUseCase {
  // 7 зависимостей — единственный use case этого тикета, собирающий воедино репозиторий,
  // оба межмодульных порта (orders/tenant-settings), UoW+outbox (атомарность критерия приёмки
  // 4) и общие порты shared-kernel (Clock/IdGenerator). Тот же приём, что `CheckoutUseCase`
  // (explicit @Inject на каждом параметре сохраняет граф зависимостей видимым в providers[]
  // модуля, а не скрывает его за анонимной фабрикой/искусственной bag-класс-оберткой без
  // собственной семантики).
  // eslint-disable-next-line max-params -- см. комментарий выше, C5 недостижим без сокрытия графа зависимостей за фабрикой
  public constructor(
    @Inject(SUPPORT_TICKETS_REPOSITORY) private readonly repository: SupportTicketsRepositoryPort,
    @Inject(SUPPORT_ORDERS_FACADE_PORT) private readonly ordersFacade: SupportOrdersFacadePort,
    @Inject(SUPPORT_TENANT_SETTINGS_PORT) private readonly tenantSettings: SupportTenantSettingsPort,
    @Inject(SUPPORT_UNIT_OF_WORK) private readonly unitOfWork: SupportUnitOfWorkPort,
    @Inject(SUPPORT_OUTBOX) private readonly outbox: SupportOutboxPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: CreateSupportTicketCommand): Promise<CreateSupportTicketResult> {
    await this.assertOwnershipIfCustomerOrder(command)
    const category = parseCategory(command.category)
    const firstResponseSlaMinutes = await this.tenantSettings.getFirstResponseSlaMinutes(command.tenantId)
    const now = this.clock.now()

    // `exactOptionalPropertyTypes`: клавиши-опционалы включаются ТОЛЬКО когда определены —
    // явный `key: undefined` не совпадает с «отсутствующий ключ» под этим флагом компилятора.
    const ticket = SupportTicket.open(
      {
        id: this.ids.next(),
        tenantId: command.tenantId,
        channel: command.channel,
        category,
        firstResponseSlaMinutes,
        ...(command.orderId !== undefined && { orderId: command.orderId }),
        ...(command.createdBy !== undefined && { createdBy: command.createdBy }),
        ...(command.description !== undefined && { description: command.description }),
      },
      now,
    )

    return this.unitOfWork.run(async (tx) => {
      await this.repository.save(ticket, tx)
      await this.outbox.append(
        command.tenantId,
        {
          type: 'SupportTicketCreatedEvent',
          ticketId: ticket.id,
          tenantId: ticket.tenantId,
          orderId: ticket.orderId,
          category: ticket.category.value,
          channel: ticket.channel,
          priority: CREATED_TICKET_PRIORITY,
        },
        tx,
      )
      return { ticketId: ticket.id }
    })
  }

  /**
   * SRS-ADM-053/§6.1 — второй рубеж защиты (RBAC presentation-слоя — первый, DTJ-281+, вне
   * периметра): `customer`, указавший чужой `orderId` по не-системному каналу, получает отказ
   * ДО того, как `SupportTicket.open()` вообще вызывается.
   */
  private async assertOwnershipIfCustomerOrder(command: CreateSupportTicketCommand): Promise<void> {
    if (command.orderId === undefined || command.channel === 'system_auto' || command.actorRole !== 'customer') {
      return
    }
    const customerId = command.createdBy ?? ''
    const belongs = await this.ordersFacade.belongsToCustomer(command.tenantId, command.orderId, customerId)
    if (!belongs) {
      throw new ForbiddenError('Order does not belong to this customer', { orderId: command.orderId })
    }
  }
}

function parseCategory(raw: string): SupportTicketCategory {
  const result = SupportTicketCategory.parse(raw)
  if (isErr(result)) {
    throw result.error
  }
  return result.value
}
