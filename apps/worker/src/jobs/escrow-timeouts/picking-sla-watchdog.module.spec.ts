import { beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'

function applyRequiredTestEnv(): void {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
  process.env.REDIS_URL ??= 'redis://localhost:6379/0'
  process.env.API_INTERNAL_URL ??= 'http://localhost:3000'
}

describe('PickingSlaWatchdogModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется через Test.createTestingModule(...).compile() без ошибок резолвинга зависимостей', async () => {
    const { ConfigModule } = await import('../../config/config.module.js')
    const { PickingSlaWatchdogModule } = await import('./picking-sla-watchdog.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PickingSlaWatchdogModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  })
})