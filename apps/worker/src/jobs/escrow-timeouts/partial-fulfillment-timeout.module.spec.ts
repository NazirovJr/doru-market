/**
 * DI-регресс-щит для `PartialFulfillmentTimeoutModule` (EP-12, DTJ-304) — тот же приём, что
 * `mock-bank-auto-pay.module.spec.ts` (EP-10, DTJ-238): поднимает модуль целиком через
 * `Test.createTestingModule(...).compile()`, как это делает `AppModule` при бутстрапе —
 * ловит «тихий» неинжектированный параметр раньше прод-старта.
 *
 * Реальных сетевых соединений не открывает: `REDIS_CONNECTION`/`Worker` подключаются лениво.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'

function applyRequiredTestEnv(): void {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
  process.env.REDIS_URL ??= 'redis://localhost:6379/0'
  process.env.API_INTERNAL_URL ??= 'http://localhost:3000'
}

describe('PartialFulfillmentTimeoutModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется через Test.createTestingModule(...).compile() без ошибок резолвинга зависимостей', async () => {
    const { ConfigModule } = await import('../../config/config.module.js')
    const { PartialFulfillmentTimeoutModule } = await import('./partial-fulfillment-timeout.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PartialFulfillmentTimeoutModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  })
})
