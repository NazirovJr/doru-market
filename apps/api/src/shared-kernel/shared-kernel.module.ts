/**
 * `SharedKernelModule` (EP-01, DTJ-006) — экспортирует общие порты `Clock` и
 * `IdGenerator` для всех модулей. Регистрируется в `AppModule.imports` ОДИН РАЗ
 * (правило D-27 — barrel, пополняется строками).
 */
import { Global, Module } from '@nestjs/common'
// Внутренние импорты — ПРЯМО из файлов (D-27: barrel — только для межмодульного использования,
// иначе цикл `module → barrel → module`, отвергаемый depcruise `no-circular`).
import { CLOCK } from './application/ports/clock.port.js'
import { ID_GENERATOR } from './application/ports/id-generator.port.js'
import { SystemClockAdapter } from './infrastructure/adapters/system-clock.adapter.js'
import { UuidV7IdGeneratorAdapter } from './infrastructure/adapters/uuidv7-id-generator.adapter.js'

@Global()
@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClockAdapter },
    { provide: ID_GENERATOR, useClass: UuidV7IdGeneratorAdapter },
    SystemClockAdapter,
    UuidV7IdGeneratorAdapter,
  ],
  exports: [CLOCK, ID_GENERATOR],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class SharedKernelModule {}
