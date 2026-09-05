/**
 * Unit-тесты `OnboardingFacade.suspendChainForUnpaidInvoice` (DTJ-252, REQ-MON-9). Остальные
 * методы фасада (`isPharmacyActive`/`getPharmacySuspensionReason`/`getPharmacyNames`/
 * `getChainEligibilityForWhitelabel`) не покрыты ЭТИМ файлом — до DTJ-252 у класса не было
 * собственного `.spec.ts` (поведение проверялось косвенно через потребителей, напр.
 * `checkout.use-case.spec.ts` с fake `OnboardingFacadePort`) — этот файл заводится заново
 * ТОЛЬКО для новой логики этого тикета, не претендует на ретроактивное покрытие чужого кода.
 */
import { describe, expect, it, vi } from 'vitest'
import { InvalidOnboardingTransitionError, NotFoundError } from '@dorutj/contracts'
import { OnboardingFacade } from './onboarding.facade.js'
import { PharmacyChain, type PharmacyChainCreateCommand } from './domain/pharmacy-chain.entity.js'
import type { PharmacyChainRepositoryPort } from './application/ports/pharmacy-chain.repository.port.js'
import type { PharmacyAccountRepositoryPort } from './application/ports/pharmacy-account.repository.port.js'
import type { OnboardingStatus } from './domain/value-objects/onboarding-status.vo.js'

const ACTOR = { id: 'system-actor-uuid' }

function newChainCommand(overrides?: Partial<PharmacyChainCreateCommand>): PharmacyChainCreateCommand {
  return {
    id: 'chain-uuid-1',
    name: 'Pharma LLC',
    legalEntityName: 'Pharma LLC',
    tinInn: '123456789',
    directorFullName: 'Ivanov Ivan',
    contactPhone: '+992900000000',
    legalAddress: 'Dushanbe, str. A',
    isWhitelabelRequested: false,
    ...overrides,
  }
}

function chainAtStatus(status: OnboardingStatus): PharmacyChain {
  return PharmacyChain.restore({ ...PharmacyChain.create(newChainCommand()).props, status })
}

/** Ни один из тестов ниже не касается `PharmacyAccountRepositoryPort` — минимальная заглушка. */
function fakeAccountRepository(): PharmacyAccountRepositoryPort {
  return {
    findById: vi.fn().mockResolvedValue(null),
    listByStatus: vi.fn(),
    listByChain: vi.fn(),
    save: vi.fn(),
  }
}

/** Возвращает порт И отдельную переменную `save` (не `repository.save`) — @typescript-eslint/unbound-method. */
function fakeChainRepository(chain: PharmacyChain | null): { repository: PharmacyChainRepositoryPort; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn().mockResolvedValue(undefined)
  const repository: PharmacyChainRepositoryPort = {
    findById: vi.fn().mockResolvedValue(chain),
    findByTinInn: vi.fn(),
    listByStatus: vi.fn(),
    save,
  }
  return { repository, save }
}

describe('OnboardingFacade.suspendChainForUnpaidInvoice (DTJ-252)', () => {
  it('active → suspended: находит цепь, вызывает chain.suspend(), сохраняет', async () => {
    const chain = chainAtStatus('active')
    const { repository, save } = fakeChainRepository(chain)
    const facade = new OnboardingFacade(fakeAccountRepository(), repository)

    await facade.suspendChainForUnpaidInvoice(chain.id, ACTOR)

    expect(save).toHaveBeenCalledOnce()
    const saved = save.mock.calls[0]?.[0] as PharmacyChain
    expect(saved.status).toBe('suspended')
  })

  it('уже suspended → идемпотентный no-op, save() НЕ вызывается', async () => {
    const chain = chainAtStatus('suspended')
    const { repository, save } = fakeChainRepository(chain)
    const facade = new OnboardingFacade(fakeAccountRepository(), repository)

    await facade.suspendChainForUnpaidInvoice(chain.id, ACTOR)

    expect(save).not.toHaveBeenCalled()
  })

  it('chainId не существует → NotFoundError, save() НЕ вызывается', async () => {
    const { repository, save } = fakeChainRepository(null)
    const facade = new OnboardingFacade(fakeAccountRepository(), repository)

    await expect(facade.suspendChainForUnpaidInvoice('missing-chain', ACTOR)).rejects.toBeInstanceOf(NotFoundError)
    expect(save).not.toHaveBeenCalled()
  })

  it('цепь в состоянии, откуда suspend() недопустим (напр. draft) → InvalidOnboardingTransitionError пробрасывается', async () => {
    const chain = chainAtStatus('draft')
    const { repository, save } = fakeChainRepository(chain)
    const facade = new OnboardingFacade(fakeAccountRepository(), repository)

    await expect(facade.suspendChainForUnpaidInvoice(chain.id, ACTOR)).rejects.toBeInstanceOf(InvalidOnboardingTransitionError)
    expect(save).not.toHaveBeenCalled()
  })
})
