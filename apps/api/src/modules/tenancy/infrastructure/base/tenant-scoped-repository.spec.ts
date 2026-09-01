/**
 * `tenant-scoped-repository.spec.ts` (DTJ-056, EP-02) — unit-тест
 * базового класса `TenantScopedRepository`. Проверяет рантайм-рубеж
 * `assertTenantId` (защита от обхода типов через `any`/`unknown`),
 * шаблонный метод `scoped`, и compile-time контракт.
 *
 * @see apps/api/src/modules/tenancy/infrastructure/base/tenant-scoped-repository.ts
 */
import { describe, expect, it } from 'vitest'
import {
  InvalidTenantIdError,
  TenantScopedRepository,
} from './tenant-scoped-repository.js'
import { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'

interface FakeEntity {
  readonly id: string
}

/** Конкретный наследник, чтобы проверить рантайм-рубеж. */
class TestRepo extends TenantScopedRepository<FakeEntity> {
  /**
   * Публичный wrapper для `assertTenantId` — нужен в тесте, чтобы
   * обойти TypeScript protected-модификатор. Не для продакшена.
   */
  publicCheckTenantId(tenantId: TenantId): void {
    this.assertTenantId(tenantId)
  }

  /**
   * Публичный wrapper для `scoped` — нужен в тесте.
   */
  publicScoped<T>(tenantId: TenantId, fn: (id: TenantId) => Promise<T>): Promise<T> {
    return this.scoped(tenantId, fn)
  }

  // `findById` сознательно без async/await: тест проверяет, что
  // `scoped()` бросает InvalidTenantIdError ПЕРЕД вызовом query-функции,
  // а сам query-функция возвращает Promise.resolve. Это упрощает unit-тест.
  findById(tenantId: TenantId, id: string): Promise<FakeEntity | null> {
    return this.publicScoped(tenantId, () => Promise.resolve({ id }))
  }
}

describe('TenantScopedRepository (DTJ-056) — базовый класс тенант-скоупных репозиториев', () => {
  // Версия/вариант-нибблы (`4`/`8`) обязательны — `uuid`'s `validate()`
  // (используется в `TenantId.from`) проверяет RFC 9562 формат строго.
  const TENANT_A_ID = '00000000-0000-4000-8000-0000000000a1'
  const tenantA = TenantId.from(TENANT_A_ID)

  describe('assertTenantId', () => {
    it('проходит валидный TenantId', () => {
      const repo = new TestRepo()
      expect(() => {
        repo.publicCheckTenantId(tenantA)
      }).not.toThrow()
    })

    it('бросает InvalidTenantIdError на undefined (обход типов через any)', () => {
      const repo = new TestRepo()
      expect(() => {
        repo.publicCheckTenantId(undefined as unknown as TenantId)
      }).toThrow(InvalidTenantIdError)
    })

    it('бросает InvalidTenantIdError на null', () => {
      const repo = new TestRepo()
      expect(() => {
        repo.publicCheckTenantId(null as unknown as TenantId)
      }).toThrow(InvalidTenantIdError)
    })

    it('бросает InvalidTenantIdError на объект без поля value', () => {
      const repo = new TestRepo()
      expect(() => {
        repo.publicCheckTenantId({} as unknown as TenantId)
      }).toThrow(InvalidTenantIdError)
    })

    it('бросает InvalidTenantIdError на пустую строку в value', () => {
      const repo = new TestRepo()
      const fakeTenantId = { value: '' } as unknown as TenantId
      expect(() => {
        repo.publicCheckTenantId(fakeTenantId)
      }).toThrow(InvalidTenantIdError)
    })
  })

  describe('scoped', () => {
    it('возвращает результат query-функции при валидном tenantId', async () => {
      const repo = new TestRepo()
      const result = await repo.publicScoped(tenantA, (id) => {
        expect(id).toBe(tenantA)
        return Promise.resolve('ok')
      })
      expect(result).toBe('ok')
    })

    it('бросает InvalidTenantIdError ПЕРЕД вызовом query-функции при undefined', async () => {
      const repo = new TestRepo()
      const queryFn = (): Promise<string> => Promise.resolve('should-not-be-called')
      await expect(
        repo.publicScoped(undefined as unknown as TenantId, queryFn),
      ).rejects.toThrow(InvalidTenantIdError)
    })
  })

  describe('compile-time контракт (документируется в тесте)', () => {
    it('наследник обязан объявить TEntity в сигнатуре класса', () => {
      // Этот тест — compile-time гарантия, что класс TestRepo скомпилирован.
      // Если `class TestRepo extends TenantScopedRepository<FakeEntity>`
      // не пройдёт проверку типов (например, если изменится сигнатура
      // базового класса), сам этот файл не скомпилируется.
      const repo = new TestRepo()
      expect(repo).toBeInstanceOf(TenantScopedRepository)
    })
  })

  describe('InvalidTenantIdError', () => {
    it('имеет правильное имя', () => {
      const err = new InvalidTenantIdError()
      expect(err.name).toBe('InvalidTenantIdError')
      expect(err.message).toBe('tenantId is required')
    })

    it('принимает кастомное сообщение', () => {
      const err = new InvalidTenantIdError('custom message')
      expect(err.message).toBe('custom message')
    })
  })
})