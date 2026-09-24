import { Global, Module } from '@nestjs/common'
import { DomainEventHandlerRegistry } from './domain-event-handler.js'
import { DomainEventsRouter } from './domain-events.router.js'
import { domainEventsRedisConnectionProvider } from './domain-events-redis-connection.provider.js'
import { PROCESSED_EVENTS_PORT_PROVIDER } from './drizzle-processed-events.repository.js'
import { PROCESSED_EVENTS_PORT } from './processed-events.port.js'

@Global()
@Module({
  providers: [DomainEventHandlerRegistry, domainEventsRedisConnectionProvider, DomainEventsRouter, PROCESSED_EVENTS_PORT_PROVIDER],
  exports: [DomainEventHandlerRegistry, PROCESSED_EVENTS_PORT],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class DomainEventsModule {}
