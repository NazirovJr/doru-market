/**
 * AC4 (DTJ-240, SRS-PAY-011): `EscrowLedgerRepository` физически не объявляет `update()`/
 * `delete()` — попытка вызвать их ошибка КОМПИЛЯЦИИ, не соглашение в комментарии.
 *
 * Приём — тот же, что уже применён в модуле `orders`
 * (`application/cart/ports/cart.repository.port.spec.ts`, DTJ-227): `@ts-expect-error` перед
 * обращением к несуществующему члену типа. Если кто-то в будущем случайно добавит `update`/
 * `delete` в интерфейс — строка `@ts-expect-error` перестанет подавлять реальную ошибку
 * компиляции и САМА станет ошибкой («Unused '@ts-expect-error' directive»),
 * `tsc --noEmit`/`pnpm typecheck` покраснеет — гейт ловит регресс, не только фиксирует
 * сегодняшнее состояние.
 *
 * Этот файл — В `infrastructure/repositories/`, НЕ в `application/ports/` (где формально
 * живёт AC4): `application`-слою запрещено импортировать `infrastructure/**`
 * (`dependency-cruiser` `application-does-not-know-infrastructure`,
 * `no-restricted-imports` — проверено, ловит именно эту попытку), а тест конструирует
 * РЕАЛЬНУЮ реализацию (`DrizzleEscrowLedgerRepository`), не `{} as EscrowLedgerRepository` —
 * `infrastructure → application` (порт) разрешено, обратное нет (`02` §1.1). Порт остаётся
 * контрактной точкой истины для AC4, этот файл лишь физически размещён там, где ему можно
 * держать импорт конкретного класса.
 *
 * `typeof repo.update` (не `repo.update(...)`) — обращение к свойству допустимо в рантайме
 * (вернёт `undefined`, JS не бросает на чтении отсутствующего свойства), а ВЫЗОВ как функции
 * бросил бы `TypeError` и уронил бы сам тест, а не то, что он проверяет. Так тест доказывает
 * ОБА рубежа: TS отклоняет обращение на этапе компиляции, а рантайм подтверждает — метода
 * действительно физически нет (не просто скрыт типами).
 *
 * Конструктор не открывает соединение (см. JSDoc `escrow-ledger.repository.ts`, тот же
 * приём, что `CatalogRepositoryAdapter`) — фиктивный `DrizzleDb`-стаб безопасен здесь.
 */
import { describe, expect, it } from 'vitest'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import type { EscrowLedgerRepository } from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import { DrizzleEscrowLedgerRepository } from './escrow-ledger.repository.js'

function makeRepository(): EscrowLedgerRepository {
  const fakeDb = {} as DrizzleDb
  return new DrizzleEscrowLedgerRepository(fakeDb)
}

describe('EscrowLedgerRepository — append-only, update()/delete() не существуют (AC4, SRS-PAY-011)', () => {
  it('update — компилятор отклоняет обращение, рантайм подтверждает отсутствие метода', () => {
    const repo = makeRepository()
    // @ts-expect-error — update() физически не объявлен в EscrowLedgerRepository (AC4).
    expect(typeof repo.update).toBe('undefined')
  })

  it('delete — компилятор отклоняет обращение, рантайм подтверждает отсутствие метода', () => {
    const repo = makeRepository()
    // @ts-expect-error — delete() физически не объявлен в EscrowLedgerRepository (AC4).
    expect(typeof repo.delete).toBe('undefined')
  })

  it('санитарный кейс: append/findByOrderId/sumByType — легальные члены интерфейса, компилируются', () => {
    const repo = makeRepository()
    expect(typeof repo.append).toBe('function')
    expect(typeof repo.findByOrderId).toBe('function')
    expect(typeof repo.sumByType).toBe('function')
  })
})
