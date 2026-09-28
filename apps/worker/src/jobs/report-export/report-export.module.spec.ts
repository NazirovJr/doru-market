import { beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'

function applyRequiredTestEnv(): void {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
  process.env.REDIS_URL ??= 'redis://localhost:6379/0'
}

describe('ReportExportModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется через Test.createTestingModule(...).compile() без ошибок резолвинга зависимостей', async () => {
    const { ConfigModule } = await import('../../config/config.module.js')
    const { ReportExportModule } = await import('./report-export.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ReportExportModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  })
})
