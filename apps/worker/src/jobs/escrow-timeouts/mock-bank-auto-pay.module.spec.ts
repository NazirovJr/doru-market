/**
 * DI-регресс-щит для `MockBankAutoPayModule` (EP-10, DTJ-238) — тот же приём, что
 * `modules/orders/orders.module.full-boot.di.spec.ts` (apps/api), адаптированный к apps/worker:
 * поднимает модуль ЦЕЛИКОМ через `Test.createTestingModule(...).compile()`, как это делает
 * `AppModule` при бутстрапе. Ни один существующий модуль apps/worker такого теста не имеет
 * (project-wide gap, вне периметра этого тикета) — заведён здесь намеренно: это ПЕРВЫЙ
 * consumer, обрабатывающий job data, произведённую ДРУГИМ приложением (apps/api), и первый
 * `Worker`-класс с цепочкой зависимостей (`REDIS_CONNECTION` + `ConfigService` + бесточенный
 * `MockBankAutoPayJob`) — риск «тихого» неинжектированного параметра (см. JSDoc
 * `tests/arch/di-explicit-inject.spec.ts`, которая apps/worker НЕ сканирует) реален именно
 * здесь.
 *
 * Реальных сетевых соединений не открывает: `REDIS_CONNECTION`/`Worker` подключаются лениво
 * (BullMQ не шлёт команд синхронно при конструировании).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'

function applyRequiredTestEnv(): void {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
  process.env.REDIS_URL ??= 'redis://localhost:6379/0'
  process.env.MOCK_BANK_WEBHOOK_SECRET ??= 'test-mock-bank-webhook-secret-di-spec'
  process.env.API_INTERNAL_URL ??= 'http://localhost:3000'
}

describe('MockBankAutoPayModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется через Test.createTestingModule(...).compile() без ошибок резолвинга зависимостей', async () => {
    const { ConfigModule } = await import('../../config/config.module.js')
    const { MockBankAutoPayModule } = await import('./mock-bank-auto-pay.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, MockBankAutoPayModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  })
})
