/**
 * Публичный фасад-баррель модуля `delivery` (EP-13, DTJ-314). `02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §1.2: единственный легальный путь межмодульного взаимодействия (`orders`, `payments`,
 * `billing`, `returns`). Прямой импорт `modules/delivery/domain|application|infrastructure|
 * presentation/*` из другого модуля — блокирующее нарушение (`dependency-cruiser`
 * `no-cross-module-deep-import`, DoD DTJ-314).
 *
 * Экспортирует ТОЛЬКО: `DeliveryModule` (для `app.module.ts`), `DeliveryFacade` + типы,
 * используемые её публичными методами, и `DeliveryDomainEvent` (для будущих потребителей outbox
 * вне модуля, напр. `apps/worker`). НИЧЕГО из `domain/**`/`application/use-cases/**` напрямую —
 * остальные экспорты добавляются строками по мере готовности следующих тикетов (D-27).
 *
 * `DeliveryFacade` — обычный `@Injectable()` класс, используемый как собственный DI-токен
 * (`@Inject(DeliveryFacade)` у потребителя, тот же приём, что `OnboardingFacade`) — отдельный
 * `Symbol`-токен не заводится.
 */
export { DeliveryModule } from './delivery.module.js'
export {
  DeliveryFacade,
  type CreateDeliveryAssignmentInput,
  type ReturnCourierAssignment,
} from './application/delivery.facade.js'
export type { DeliveryAssignmentSnapshot } from './domain/delivery-assignment-snapshot.js'
export type { DeliveryDomainEvent } from './domain/delivery-domain-event.js'
