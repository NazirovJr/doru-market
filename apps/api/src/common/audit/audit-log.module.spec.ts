/**
 * `AuditLogModule` (EP-16, DTJ-374) — DI-тест AC4: `AuditLogPort` резолвится в модуле,
 * который НЕ импортирует `AuditLogModule` явно (подтверждение `@Global()`-регистрации, см.
 * JSDoc самого модуля). `app.module.spec.ts` (Ж2) уже поднимает `AppModule` целиком и
 * КОСВЕННО доказывает, что регистрация `AuditLogModule` в корне не ломает граф — этот файл
 * ПРЯМО воспроизводит буквальный сценарий AC4: «гипотетический тестовый модуль», не
 * упомянутый ни в одном `imports: [...]`, всё равно получает порт.
 *
 * `DRIZZLE_DB` мокнут локальным `@Global()`-модулем (не реальный Postgres) — тест проверяет
 * ФОРМУ DI-графа (резолвится ли токен), не поведение `write()` (оно покрыто
 * `infrastructure/audit-log.repository.spec.ts` и `test/integration/common/audit/
 * audit-log-repository.e2e.spec.ts`).
 */
import { Global, Inject, Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'
import { DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { AuditLogModule } from './audit-log.module.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from './audit-log.port.js'

@Global()
@Module({ providers: [{ provide: DRIZZLE_DB, useValue: { execute: () => Promise.resolve(undefined) } }], exports: [DRIZZLE_DB] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- тестовый мок реального @Global() DatabaseModule, см. JSDoc файла.
class FakeDatabaseModule {}

/** «Гипотетический тестовый модуль» из буквального текста AC4 — намеренно НЕ импортирует `AuditLogModule`. */
@Injectable()
class FakeConsumerService {
  public constructor(@Inject(AUDIT_LOG_PORT) public readonly auditLog: AuditLogPort) {}
}

@Module({ providers: [FakeConsumerService] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
class FakeConsumerModule {}

describe('AuditLogModule — @Global() (DTJ-374, AC4)', () => {
  it('AuditLogPort резолвится в потребителе БЕЗ imports: [AuditLogModule] в его собственном модуле', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDatabaseModule, AuditLogModule, FakeConsumerModule],
    }).compile()

    const consumer = moduleRef.get(FakeConsumerService)
    expect(consumer.auditLog).toBeDefined()
    expect(typeof consumer.auditLog.write).toBe('function')

    await moduleRef.close()
  })
})
