/**
 * NestJS-модуль `notifications` (EP-16, DTJ-368). Barrel-файл (D-27): правится ТОЛЬКО добавлением
 * строк, перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * `notifications` — application-уровня контекст БЕЗ богатого домена (`10-domain-model.md`:
 * `NotificationJob`), Provider Pattern по каналу (`NotifyProviderPort`, см. его JSDoc):
 *   - `NOTIFY_PROVIDER_TELEGRAM` → `TelegramNotifyProvider` (реален, этот тикет).
 *   - `NOTIFY_PROVIDER_IN_APP` → `InAppNotifyProvider` (реален, этот тикет).
 *   - `NOTIFY_PROVIDER_SMS` / `NOTIFY_PROVIDER_PUSH` — **НЕ забинжены.** Токены объявлены
 *     (`notify-provider.port.ts`), но `auth.SmsProviderPort.sendOtp(phone, code, purpose)` —
 *     OTP-специфичная сигнатура (`OtpPurpose = 'login' | 'onboarding_contact'`), НЕ совместима
 *     структурно с generic `NotifyProviderPort.send(userId, channel, message)` без придумывания
 *     семантики (передать текст произвольного уведомления вместо OTP-кода было бы подделкой
 *     поведения, не адаптером). Реализации генерик-push (`WebPushProvider`/`MockPushProvider`)
 *     — ПРОВЕРЕНО: не существует НИГДЕ в кодовой базе, вопреки технической части тикета DTJ-368
 *     («SmsProvider/PushProvider УЖЕ существуют как инфраструктура contextа identity»). Оба факта
 *     — расхождение между тикетом и фактическим состоянием репозитория, зафиксировано для
 *     координатора/Tech Lead (см. отчёт сдачи тикета), не додумано молча (`05-DEVELOPER-HANDBOOK.md`
 *     §10). Добавление обоих токенов — тривиальная правка ОДНОЙ строки в `providers`, когда
 *     появится (а) generic-метод отправки текста в `auth` (гостевая правка ИЛИ новый узкий порт) и
 *     (б) реальный push-провайдер (отдельный тикет/эпик).
 *
 * `IDENTITY_FACADE_PORT`/`NOTIFICATIONS_REPOSITORY_PORT` — вспомогательные узкие порты, нужные
 * ОБОИМ реальным провайдерам (см. их JSDoc).
 *
 * `imports: [AuthModule]` — ТОЛЬКО модуль (не барабан) во избежание цикла `module → barrel →
 * module` (тот же приём, что `admin.module.ts`); `USERS_REPOSITORY` использован через барабан
 * `@/modules/auth/index.js` в самом адаптере.
 *
 * На этом тикете добавлен `ListOwnNotificationsUseCase` и `NotificationsFeedController` для
 * `GET /api/v1/notifications` (DTJ-372).
 *
 * DTJ-369: добавлен `NOTIFICATION_TEMPLATES_REPOSITORY_PORT` → `NotificationTemplatesRepository`.
 *
 * DTJ-370: `NOTIFICATIONS_REPOSITORY_PORT` → реальный `NotificationsRepository`; добавлены
 * `DispatchNotificationUseCase`, `NOTIFICATION_DISPATCH_QUEUE_PORT` и `OutboxToNotificationsConsumer`
 * (DTJ-032: больше не держит свой `Worker` — обработчик общего роутера `common/events`).
 */
import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { TenancyModule } from '@/modules/tenancy/tenancy.module.js'
import { IDENTITY_FACADE_PORT } from './application/ports/identity-facade.port.js'
import { NOTIFICATIONS_REPOSITORY_PORT } from './application/ports/notifications-repository.port.js'
import { NOTIFY_PROVIDER_IN_APP, NOTIFY_PROVIDER_TELEGRAM } from './application/ports/notify-provider.port.js'
import { NOTIFICATION_TEMPLATES_REPOSITORY_PORT } from './application/ports/notification-templates-repository.port.js'
import { NOTIFICATION_DISPATCH_QUEUE_PORT } from './application/ports/notification-dispatch-queue.port.js'
import { UsersRepositoryIdentityFacadeAdapter } from './infrastructure/adapters/users-repository-identity-facade.adapter.js'
import { TelegramNotifyProvider } from './infrastructure/providers/telegram-notify.provider.js'
import { InAppNotifyProvider } from './infrastructure/providers/in-app-notify.provider.js'
import { NotificationTemplatesRepository } from './infrastructure/repositories/notification-templates.repository.js'
import { NotificationsRepository } from './infrastructure/repositories/notifications.repository.js'
import { BullmqNotificationDispatchQueueAdapter } from './infrastructure/queues/bullmq-notification-dispatch-queue.adapter.js'
import { OutboxToNotificationsConsumer } from './infrastructure/consumers/outbox-to-notifications.consumer.js'
import { ListOwnNotificationsUseCase } from './application/use-cases/list-own-notifications.use-case.js'
import { DispatchNotificationUseCase } from './application/use-cases/dispatch-notification.use-case.js'
import { NotificationsFeedController } from './presentation/notifications-feed.controller.js'

@Module({
  imports: [AuthModule, TenancyModule],
  providers: [
    { provide: IDENTITY_FACADE_PORT, useClass: UsersRepositoryIdentityFacadeAdapter },
    { provide: NOTIFICATIONS_REPOSITORY_PORT, useClass: NotificationsRepository },
    { provide: NOTIFY_PROVIDER_TELEGRAM, useClass: TelegramNotifyProvider },
    { provide: NOTIFY_PROVIDER_IN_APP, useClass: InAppNotifyProvider },
    { provide: NOTIFICATION_TEMPLATES_REPOSITORY_PORT, useClass: NotificationTemplatesRepository },
    { provide: NOTIFICATION_DISPATCH_QUEUE_PORT, useClass: BullmqNotificationDispatchQueueAdapter },
    { provide: ListOwnNotificationsUseCase, useClass: ListOwnNotificationsUseCase },
    { provide: DispatchNotificationUseCase, useClass: DispatchNotificationUseCase },
    UsersRepositoryIdentityFacadeAdapter,
    NotificationsRepository,
    TelegramNotifyProvider,
    InAppNotifyProvider,
    NotificationTemplatesRepository,
    BullmqNotificationDispatchQueueAdapter,
    OutboxToNotificationsConsumer, // PROCESSED_EVENTS_PORT общий, см. common/events.
  ],
  exports: [
    IDENTITY_FACADE_PORT,
    NOTIFICATIONS_REPOSITORY_PORT,
    NOTIFY_PROVIDER_TELEGRAM,
    NOTIFY_PROVIDER_IN_APP,
    NOTIFICATION_TEMPLATES_REPOSITORY_PORT,
    DispatchNotificationUseCase,
  ],
  controllers: [NotificationsFeedController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class NotificationsModule {}
