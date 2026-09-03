import { describe, expect, it } from 'vitest'
import { InMemoryCartIdentityRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-identity-repository.fixture.js'
import { ResolveOrCreateCartUseCase } from './resolve-or-create-cart.use-case.js'

const TENANT_ID = 'tenant-1'

describe('ResolveOrCreateCartUseCase (DTJ-226, D-EP09-22/D-EP09-23)', () => {
  it('customerId задан, корзины ещё нет — создаёт её, issuedSessionToken не выставляется', async () => {
    const repo = new InMemoryCartIdentityRepository()
    const useCase = new ResolveOrCreateCartUseCase(repo)

    const result = await useCase.execute(TENANT_ID, { customerId: 'customer-1', sessionToken: null })

    expect(result.cart.customerId).toBe('customer-1')
    expect(result.cart.sessionToken).toBeNull()
    expect(result.issuedSessionToken).toBeNull()
  })

  it('customerId задан, корзина УЖЕ есть — возвращает ТУ ЖЕ корзину, не создаёт вторую', async () => {
    const repo = new InMemoryCartIdentityRepository()
    const useCase = new ResolveOrCreateCartUseCase(repo)
    const first = await useCase.execute(TENANT_ID, { customerId: 'customer-1', sessionToken: null })

    const second = await useCase.execute(TENANT_ID, { customerId: 'customer-1', sessionToken: null })

    expect(second.cart.id).toBe(first.cart.id)
  })

  it('гость с уже выданным sessionToken — резолвит существующую корзину, issuedSessionToken не выставляется', async () => {
    const repo = new InMemoryCartIdentityRepository()
    repo.seedCart({ id: 'guest-cart-1', tenantId: TENANT_ID, customerId: null, sessionToken: 'known-token' })
    const useCase = new ResolveOrCreateCartUseCase(repo)

    const result = await useCase.execute(TENANT_ID, { customerId: null, sessionToken: 'known-token' })

    expect(result.cart.id).toBe('guest-cart-1')
    expect(result.issuedSessionToken).toBeNull()
  })

  it('гость с НЕИЗВЕСТНЫМ (протухшим) sessionToken — НЕ создаёт корзину под этим значением, выдаёт НОВЫЙ серверный токен', async () => {
    const repo = new InMemoryCartIdentityRepository()
    const useCase = new ResolveOrCreateCartUseCase(repo)

    const result = await useCase.execute(TENANT_ID, { customerId: null, sessionToken: 'stale-token' })

    expect(result.cart.sessionToken).not.toBe('stale-token')
    expect(result.issuedSessionToken).not.toBeNull()
    expect(result.cart.sessionToken).toBe(result.issuedSessionToken)
  })

  it('session fixation (правка приёмки CTO): клиент присылает угадываемый токен, под которым корзины нет — сервер НЕ создаёт корзину под ним, выдаёт новый, повторный запрос со старым значением снова его не видит', async () => {
    const repo = new InMemoryCartIdentityRepository()
    const useCase = new ResolveOrCreateCartUseCase(repo)
    const guessableToken = 'guessable-token'

    const result = await useCase.execute(TENANT_ID, { customerId: null, sessionToken: guessableToken })

    expect(result.issuedSessionToken).not.toBeNull()
    expect(result.issuedSessionToken).not.toBe(guessableToken)
    // Гарантия свойства безопасности: под угаданным значением строка `cart` НЕ появилась.
    expect(await repo.findBySessionToken(TENANT_ID, guessableToken)).toBeNull()

    // Повторный запрос с ТЕМ ЖЕ угадываемым значением — снова не видит созданную ранее корзину
    // (та живёт под сервер-сгенерированным `issuedSessionToken`, не под `guessableToken`).
    const repeat = await useCase.execute(TENANT_ID, { customerId: null, sessionToken: guessableToken })
    expect(repeat.cart.id).not.toBe(result.cart.id)
    expect(repeat.issuedSessionToken).not.toBe(guessableToken)
  })

  it('первый визит гостя (ни customerId, ни sessionToken) — генерирует НОВЫЙ криптостойкий токен и возвращает его в issuedSessionToken', async () => {
    const repo = new InMemoryCartIdentityRepository()
    const useCase = new ResolveOrCreateCartUseCase(repo)

    const result = await useCase.execute(TENANT_ID, { customerId: null, sessionToken: null })

    expect(result.issuedSessionToken).not.toBeNull()
    expect(result.cart.sessionToken).toBe(result.issuedSessionToken)
    expect(result.cart.customerId).toBeNull()
    // base64url(32 байта) — без URL-небезопасных символов, разумная минимальная длина.
    expect(result.issuedSessionToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
  })

  it('два первых визита БЕЗ токена генерируют РАЗНЫЕ токены/корзины (нет общей идентичности для сериализации)', async () => {
    const repo = new InMemoryCartIdentityRepository()
    const useCase = new ResolveOrCreateCartUseCase(repo)

    const a = await useCase.execute(TENANT_ID, { customerId: null, sessionToken: null })
    const b = await useCase.execute(TENANT_ID, { customerId: null, sessionToken: null })

    expect(a.issuedSessionToken).not.toBe(b.issuedSessionToken)
    expect(a.cart.id).not.toBe(b.cart.id)
  })

  it('customerId приоритетнее sessionToken, если оба переданы (не должно случаться при корректном guard, но контракт явный)', async () => {
    const repo = new InMemoryCartIdentityRepository()
    const useCase = new ResolveOrCreateCartUseCase(repo)

    const result = await useCase.execute(TENANT_ID, { customerId: 'customer-1', sessionToken: 'ignored-token' })

    expect(result.cart.customerId).toBe('customer-1')
    expect(result.cart.sessionToken).toBeNull()
  })
})
