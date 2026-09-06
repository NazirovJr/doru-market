/**
 * `UnimplementedNotificationsRepositoryAdapter` (DTJ-368, EP-16) — временная заглушка
 * `NotificationsRepositoryPort`, СВЯЗАННАЯ в `notifications.module.ts` до сдачи `DTJ-369`/`DTJ-370`
 * (реальная Drizzle-схема таблицы `notifications` + репозиторий). Тот же приём, что
 * `Unimplemented*FacadeAdapter` в `modules/orders/orders.module.ts` (D-EP09-16): `create()` —
 * ЗАПИСЬ, у записи нет безопасного дефолта — адаптер БРОСАЕТ явно, а не молча создаёт
 * правдоподобную, но фиктивную запись.
 */
import { Injectable } from '@nestjs/common'
import {
  type CreateNotificationInput,
  type NotificationRecord,
  type NotificationsRepositoryPort,
} from '@/modules/notifications/application/ports/notifications-repository.port.js'

@Injectable()
export class UnimplementedNotificationsRepositoryAdapter implements NotificationsRepositoryPort {
  public create(_input: CreateNotificationInput): Promise<NotificationRecord> {
    return Promise.reject(
      new Error('NotificationsRepositoryPort.create() has no implementation yet — TODO(DTJ-369/370): bind a real adapter.'),
    )
  }
}
