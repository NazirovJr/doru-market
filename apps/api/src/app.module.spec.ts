/**
 * Подъём `AppModule` целиком (правило Ж2 «код обязан участвовать в рантайме»).
 *
 * Зачем отдельный тест, если есть typecheck, lint и 1100 юнит-тестов: НИ ОДИН из них не
 * видит ошибок сборки DI-графа. Nest резолвит зависимости в рантайме, и до этого теста
 * `AppModule` не поднимался вообще ни разу — при полностью зелёных гейтах. Найденное:
 *
 *   - `IdempotencyInterceptor` с недекорированным `reflector` перед декорированным
 *     параметром: глобальный APP_INTERCEPTOR, ронял весь граф («can't resolve
 *     dependencies of the IdempotencyInterceptor (?, ...)»). Причина — esbuild и нативный
 *     Node ESM не эмитят `design:paramtypes`, см. `tests/arch/di-explicit-inject.spec.ts`.
 *   - `OnboardingModule` не импортировал `AuthModule`, хотя его контроллеры защищены
 *     `@UseGuards(AuthGuard)`, а `AuthGuard` требует `JWT_SIGNER`. Nest создаёт guard
 *     в контексте того модуля, где он применён, — токен обязан быть виден именно там.
 *   - `PharmacyChainsPublicController` и `SearchMedicinesUseCase` — тот же дефект paramtypes.
 *
 * Тест герметичен: RSA-пара генерируется на лету (`JWT_PRIVATE_KEY` читается адаптером
 * из `process.env` при создании провайдера), реальных секретов не требуется. Запросов
 * к Postgres/Redis не делается — `compile()` только конструирует провайдеры, пул Drizzle
 * подключается лениво на первом запросе.
 */
import { generateKeyPairSync } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { afterAll, describe, expect, it } from 'vitest'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }) as string

const { AppModule } = await import('./app.module.js')

describe('AppModule — сборка DI-графа (Ж2)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>> | null = null

  afterAll(async () => {
    await moduleRef?.close()
  })

  it('поднимается целиком: каждая зависимость каждого провайдера резолвится', async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    expect(moduleRef).not.toBeNull()
  })
})
