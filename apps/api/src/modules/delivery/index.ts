export { DeliveryModule } from './delivery.module.js'
export {
  DeliveryFacade,
  type CreateDeliveryAssignmentInput,
  type ReturnCourierAssignment,
} from './application/delivery.facade.js'
export type { DeliveryAssignmentSnapshot } from './domain/delivery-assignment-snapshot.js'
export type { DeliveryDomainEvent } from './domain/delivery-domain-event.js'
// DTJ-364: admin провижинит couriers узким адаптером поверх репозитория, не через DeliveryFacade.
export { Courier, type CourierCreateCommand } from './domain/courier.entity.js'
export { COURIER_REPOSITORY, type CourierRepositoryPort } from './application/ports/courier.repository.port.js'
